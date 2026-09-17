/**
 * Reply handling role. It reads a prospect's reply and reports what it says: intent,
 * objections, commitments and the next step they asked for. The original reply is never
 * rewritten; a suggested response is a draft for the operator, not a sent message.
 */
import { z } from "zod/v4";
import type { PromptDefinition } from "../llm/structured";
import { runStructured, type CallRecorder } from "../llm/structured";
import type { LlmClient } from "../llm/types";

export const REPLY_PROMPT: PromptDefinition = {
  role: "conversation.classify",
  version: "2026-09-17.1",
  system: `You read one reply to a cold outreach email and report what it actually says.

Rules:
- Quote or closely paraphrase the reply for objections and commitments; do not infer motives.
- "unsubscribeRequested" is true only when they ask not to be contacted again, in any wording.
- An out-of-office or automated bounce is not interest: classify it as such.
- A commitment is something either side promised: a call, a document, a date, a price.
- Write a suggested reply only when a reply is warranted; it must answer what they asked, promise nothing that was not offered, and stay under 120 words. Leave it null when the right move is to stop or to wait.
- Confidence is your honest estimate that your reading is correct.`,
};

export const REPLY_INTENTS = [
  "interested",
  "question",
  "objection",
  "not_now",
  "not_interested",
  "referral",
  "unsubscribe",
  "out_of_office",
  "auto_reply",
  "other",
] as const;

export const replyOutputSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  summary: z.string().trim().min(1).max(300),
  objections: z.array(z.string().trim().min(1).max(200)).max(5),
  commitments: z.array(z.string().trim().min(1).max(200)).max(5),
  requestedNextStep: z.string().trim().max(200).nullable(),
  unsubscribeRequested: z.boolean(),
  suggestedReply: z.string().trim().max(1500).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ReplyClassification = z.infer<typeof replyOutputSchema>;

export interface ReplyRequest {
  offering: string;
  pricing: string | null;
  prospect: { company: string; person: string | null };
  history: readonly { direction: "outbound" | "inbound"; body: string }[];
  reply: string;
  today: string;
}

export function renderReplyInput(req: ReplyRequest) {
  const lines = [
    `Today is ${req.today}.`,
    "",
    "<offer>",
    req.offering,
    `pricing you may mention: ${req.pricing ?? "do not mention price"}`,
    "</offer>",
    "",
    `<prospect company="${req.prospect.company}" person="${req.prospect.person ?? "unknown"}" />`,
    "",
    "<thread>",
  ];
  for (const m of req.history) {
    lines.push(`<message from="${m.direction === "outbound" ? "us" : "them"}">`, m.body, "</message>");
  }
  lines.push("</thread>", "", "<reply-to-read>", req.reply, "</reply-to-read>");
  return lines.join("\n");
}

export interface ReplyDeps {
  llm: LlmClient;
  record: CallRecorder;
  model: string;
  runId?: string | null;
}

export async function classifyReply(deps: ReplyDeps, req: ReplyRequest) {
  const { output } = await runStructured({
    llm: deps.llm,
    record: deps.record,
    prompt: REPLY_PROMPT,
    schema: replyOutputSchema,
    user: renderReplyInput(req),
    model: deps.model,
    effort: "medium",
    runId: deps.runId ?? null,
  });
  // An unsubscribe is never answered with a sales reply, whatever the model proposes.
  if (output.unsubscribeRequested || output.intent === "unsubscribe") {
    return { ...output, unsubscribeRequested: true, suggestedReply: null };
  }
  if (output.intent === "out_of_office" || output.intent === "auto_reply") {
    return { ...output, suggestedReply: null };
  }
  return output;
}
