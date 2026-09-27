/**
 * Step-by-step setup instructions, in one place.
 *
 * Several things this system needs cannot be done from inside it: a Slack webhook, a Telegram
 * bot, a send-as address in Gmail. Until now those arrived as a sentence in a toast, which
 * vanishes, cannot be re-read, and is the wrong shape for four steps and a link. A walkthrough
 * is addressable, so anything that hits the wall can send the operator straight to it.
 */

export interface WalkthroughStep {
  /** What to do. Written as an instruction, not a description. */
  text: string;
  /** Where to do it, when that is a page rather than this app. */
  link?: { label: string; href: string };
}

export interface Walkthrough {
  id: string;
  title: string;
  /** Why anyone would do this, in one line. */
  why: string;
  /** How long it actually takes, honestly. */
  takes: string;
  steps: WalkthroughStep[];
  /** What should be true at the end, so the operator can check rather than hope. */
  done: string;
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "gmail-send-as",
    title: "Send from an alias",
    why: "An alias exists on your domain, but Gmail will not send from an address it has not been told about.",
    takes: "About a minute",
    steps: [
      {
        text: "Open Gmail as the account the mailbox is connected to, and go to Settings, then See all settings, then Accounts.",
        link: { label: "Gmail settings", href: "https://mail.google.com/mail/u/0/#settings/accounts" },
      },
      { text: "Under 'Send mail as', choose 'Add another email address'." },
      { text: "Enter the name recipients should see and the alias address, and leave 'Treat as an alias' ticked." },
      { text: "Choose Next Step, then Send Verification. An alias of your own account is usually accepted straight away." },
      { text: "If Google does send a code, it goes to the alias — which arrives in this same inbox. Paste it back." },
      { text: "Come back here and press Check again on the mailbox." },
    ],
    done: "The alias appears in Gmail's 'Send mail as' list, and Prospector shows it as ready to send from.",
  },
  {
    id: "connect-slack",
    title: "Connect Slack",
    why: "Notifications reach a Slack channel instead of waiting in the app. Free on Slack's own plan.",
    takes: "Three minutes",
    steps: [
      { text: "Create a Slack app from scratch, in the workspace you want notifications in.", link: { label: "Slack apps", href: "https://api.slack.com/apps" } },
      { text: "Open Incoming Webhooks and turn it on." },
      { text: "Choose 'Add New Webhook to Workspace', then pick the channel. A private channel with only you in it is fine." },
      { text: "Copy the webhook URL, then paste it into Connect Slack in Settings." },
    ],
    done: "A test notification arrives in the channel you chose.",
  },
  {
    id: "connect-telegram",
    title: "Connect Telegram",
    why: "Notifications arrive on your phone without another app or account.",
    takes: "Two minutes",
    steps: [
      { text: "Message @BotFather on Telegram, send /newbot, and follow the prompts.", link: { label: "BotFather", href: "https://t.me/BotFather" } },
      { text: "Copy the token it gives you." },
      { text: "Send your new bot any message. A bot may not write to you until you have written to it." },
      { text: "Open api.telegram.org/bot<your token>/getUpdates and find the chat id in the result." },
      { text: "Paste the token and the chat id into Connect Telegram in Settings." },
    ],
    done: "A test notification arrives from your bot.",
  },
  {
    id: "create-alias",
    title: "Add an address on your domain",
    why: "Each endeavour can send from its own address, on any domain your Workspace owns.",
    takes: "Five minutes, once per domain",
    steps: [
      {
        text: "In the Google admin console, add the domain under Account, then Domains, then Manage domains, as a secondary domain.",
        link: { label: "Manage domains", href: "https://admin.google.com/ac/domains/manage" },
      },
      { text: "Verify it with the TXT record Google gives you, at whoever hosts that domain's DNS." },
      { text: "Add its MX, SPF, DKIM and DMARC records too, or outreach from it will land in spam." },
      { text: "In Prospector, open Settings, find the mailbox, and choose 'Add an address'." },
      { text: "Then follow 'Send from an alias', because Gmail needs telling separately." },
    ],
    done: "The address appears under the mailbox, and can be chosen as an endeavour's sending address.",
  },
];

export const walkthroughById = (id: string) => WALKTHROUGHS.find((w) => w.id === id);
