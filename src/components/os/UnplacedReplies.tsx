import { Link } from "@tanstack/react-router";
import type { UnattributedReply } from "@/data/types";
import { MachineLabel, Panel, Tag } from "./primitives";
import { stamp } from "@/lib/format";

/**
 * Replies that could not be placed.
 *
 * They were dropped from the read model: the thread exists, the mail is stored, an approval
 * is raised — and the inbox showed nothing, so "nothing came in today" and "four arrived that
 * we could not place" looked identical. That is the worse of the two to get wrong, because
 * one of them is a prospect waiting for an answer.
 *
 * A reply the domain pointed at a prospect says so and links there: it is a guess, and the
 * fastest way to confirm a guess is to look at what it guessed.
 */
export function UnplacedReplies({ replies }: { replies: readonly UnattributedReply[] }) {
  if (replies.length === 0) return null;

  return (
    <Panel
      title="COULD NOT BE PLACED"
      meta={<MachineLabel tone="danger">{replies.length} WAITING TO BE ATTRIBUTED</MachineLabel>}
      bodyClassName="px-4 py-4"
    >
      <ul className="hairline-y" data-testid="unplaced-replies">
        {replies.map((r) => (
          <li key={r.id} className="py-2.5" data-testid="unplaced-reply">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{r.from}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {r.subject}
              </span>
              {r.guessedBy ? (
                <Tag tone="warn">GUESSED BY {r.guessedBy.toUpperCase()}</Tag>
              ) : (
                <Tag>NOTHING TO GO ON</Tag>
              )}
              <MachineLabel>{stamp(r.receivedAt)}</MachineLabel>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{r.preview}</p>
            {r.guessedProspectId && (
              <Link
                to="/prospects/$id"
                params={{ id: r.guessedProspectId }}
                className="machine mt-1 inline-block text-signal underline"
              >
                CHECK THE PROSPECT IT GUESSED
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="machine mt-3 text-muted-foreground">
        Attribute these from NEXT ACTIONS &amp; APPROVALS; nothing is lost while they sit here.
      </p>
    </Panel>
  );
}
