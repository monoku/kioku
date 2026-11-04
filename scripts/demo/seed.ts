/**
 * The seed of the demo brains (`pnpm demo`): three brains, one per tier (§2.1), with enough pages, namespaces,
 * links, superseded decisions and instincts in every state to exercise the tool and give every report something to say.
 * Everything in them is invented: Northwind is a fictional company, and its people are a list of first names.
 *
 * - `app`, the project brain of Northwind's orders application, "the app": a handful of pages written by hand below, the
 *   ones the demo shows (where to start, sources read at versions, a superseded decision, a retired page, a Skill
 *   candidate, what a search must find), and the rest generated from the team's vocabulary with a fixed seed.
 * - `team`, Northwind's team brain: sixteen namespaces in a tree, generated the same way.
 * - `sam`, the personal brain: a developer at Northwind, generated the same way.
 *
 * Nothing here is a fixture file: `make.ts` writes every page through the tool's own verbs, dated, so the brains are
 * valid by construction and carry real history.
 */

export type BrainName = "sam" | "team" | "app";
export type Kind = "memory" | "knowledge" | "rule" | "skill";
export type Sub = "decision" | "playbook" | "context" | "instinct";

export interface PagePlan {
  brain: BrainName;
  kind: Kind;
  sub?: Sub;
  namespace: string;
  title: string;
  summary?: string;
  aliases?: string[];
  source: string;
  evidence?: string;
  /** `## ` sections in the order the type asks for. */
  sections: Record<string, string>;
  /** Days before the demo's "today" the page was written. */
  age: number;
  /** Instincts: further occasions, as days before today, each later than `age`. */
  occasions?: { age: number; text: string; source: string }[];
  /** Instincts: evolved into a Skill this many days before today. */
  evolveAge?: number;
  /** Decisions: replaced by a newer one. */
  supersededBy?: {
    title: string;
    summary: string;
    age: number;
    source: string;
    sourceVersion?: string;
    evidence?: string;
    sections: Record<string, string>;
  };
  /** Knowledge, Rules, Skills: a section rewritten later, with its Changelog line. */
  edits?: { age: number; section: string; text: string; note: string }[];
  /** Pages this one is linked to later with `kioku page link`, by title. */
  linkTo?: { title: string; age: number }[];
  /** `--stale-after` at save: the day, `YYYY-MM-DD`, after which the page needs a second look. */
  staleAfter?: string;
  /** Confirmed with `kioku page confirm` this many days before today. */
  verifiedAge?: number;
  /** Retired with `kioku page retire` this many days before today. */
  retired?: { age: number; reason: string };
  /** Renamed with `kioku page rename` this many days before today; the links to it follow. */
  renamedTo?: { title: string; age: number };
  /** Instincts: evolved into a Rule or a playbook instead of a Skill. */
  evolveTo?: "rule" | "playbook";
  /** Linked later, with `kioku page link --type contradicts`, to the page of this title. */
  contradicts?: { title: string; age: number };
  /** Promoted later to a more shared brain, written again as these sections; the original is retired. */
  promoted?: { to: BrainName; age: number; sections: Record<string, string> };
  /** `--source-version` at save: which version of its source the page was written from. */
  sourceVersion?: string;
  /** Read again from a newer version of the source this many days before today, with `update --source-version`. */
  reread?: { age: number; version: string };
}

/** The demo's "today": fixed, so the brains come out the same each time. */
export const TODAY = new Date(2026, 9, 12, 12, 0, 0);

/** The brains, as the machine of §2.5 would know them. */
export const BRAINS: Record<BrainName, { tier: "personal" | "project" | "team"; repo: string; namespaces: string[] }> =
  {
    // Namespaces are paths (§3.2): a namespace, then the ones under it, parents before children.
    sam: {
      tier: "personal",
      repo: "sam/brain",
      namespaces: ["sam", "sam/tools", "sam/writing", "private", "private/learning"],
    },
    team: {
      tier: "team",
      repo: "northwind/team-brain",
      namespaces: [
        "engineering",
        "engineering/backend",
        "engineering/frontend",
        "platform",
        "platform/infrastructure",
        "platform/infrastructure/kubernetes",
        "platform/observability",
        "product",
        "product/discovery",
        "operations",
        "security",
        "security/compliance",
        "design",
        "design/system",
        "people",
        "people/hiring",
      ],
    },
    app: {
      tier: "project",
      repo: "northwind/app-brain",
      namespaces: ["app", "app/api", "app/data", "app/deploy"],
    },
  };

/** What each namespace says it is for: the paragraph under its index's title, which the agent chooses by (§3.2). */
export const NAMESPACE_SUMMARIES: Record<BrainName, Record<string, string>> = {
  sam: {
    sam: "How Sam works: preferences, tools and habits across projects.",
    "sam/tools": "Editors, shells and the dotfiles that hold them together.",
    "sam/writing": "Posts, notes and how Sam likes to explain things.",
    private: "What Sam keeps apart from any team: plans and personal context.",
    "private/learning": "What Sam is learning and the order Sam is doing it in.",
  },
  team: {
    engineering: "How the product is built and shipped: services, review, testing and the release path.",
    "engineering/backend": "Services and APIs: data models, queues, the billing service and what runs behind them.",
    "engineering/frontend": "The web apps: components, accessibility, performance budgets and browser support.",
    platform: "The shared ground the teams run on: environments, pipelines and runtime.",
    "platform/infrastructure": "Clusters, networks, databases and their upgrades.",
    "platform/infrastructure/kubernetes": "The clusters' workloads: deploys, quotas, node pools and incident notes.",
    "platform/observability": "Metrics, logs, traces and the alerts that page someone.",
    product: "What is built and why: priorities, the customers' words and what was decided.",
    "product/discovery": "Interviews, experiments and what they taught.",
    operations: "How the company runs day to day: on-call, vendors, support and routines.",
    security: "Access, secrets, reviews and what an incident asks of us.",
    "security/compliance": "Audits, evidence and the controls each customer asks about.",
    design: "How things look and behave: principles, research and critique.",
    "design/system": "The component library, its tokens and how they change.",
    people: "How the team works together: roles, rituals and agreements.",
    "people/hiring": "How we look for, interview and welcome people.",
  },
  app: {
    app: "The app, Northwind's orders application: what it is, why it is built this way and where things are.",
    "app/api": "The public API: its versions, its webhooks and the partners who call it.",
    "app/data": "The orders database: its schema, its migrations and the reports that read it.",
    "app/deploy": "How the app reaches production: environments, the pipeline, rollbacks and hotfixes.",
  },
};

// A small deterministic generator, so a regenerated demo tells the same story.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = rng(20261010);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (p: number): boolean => r() < p;
/** Ages lean recent, like a brain that is in use: most pages from the last months, a tail over a year. */
const anAge = (max = 430): number => Math.floor(Math.pow(r(), 1.6) * max);
const session = (repo: string, age: number): string => {
  const d = new Date(TODAY.getTime() - age * 86_400_000);
  return `Session ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} in ${repo}`;
};

// ---------------------------------------------------------------------------------------------------------------------
// app: Northwind's orders application, the project brain. A handful of pages by hand, the ones the demo shows; the rest
// generated below from the team's vocabulary.

/** Where the project brain's ingests read from: the app's architecture page at one commit, its deploy runbook at two. */
const ARCHITECTURE = "docs/architecture.md in northwind/app";
const RUNBOOK = "docs/runbooks/deploy.md in northwind/app";
/** Read before versions were recorded, so it names none. */
const README = "README.md in northwind/app";

function appPages(): PagePlan[] {
  const B: BrainName = "app";
  const d = (
    ns: string,
    title: string,
    summary: string,
    age: number,
    decision: string,
    why: string,
    consequences: string,
    extra: Partial<PagePlan> = {},
  ): PagePlan => ({
    brain: B,
    kind: "knowledge",
    sub: "decision",
    namespace: ns,
    title,
    summary,
    age,
    source: ARCHITECTURE,
    sections: { Decision: decision, Why: why, Consequences: consequences },
    ...extra,
  });
  const decisions: PagePlan[] = [
    d(
      "app",
      "The app is one service with one database",
      "Orders, invoices and stock live in one deployable and one Postgres; a part leaves only when its load asks for it.",
      410,
      "The app is one deployable with one Postgres database. Checkout, invoicing and stock are modules inside it, each owning its tables.",
      "Five people run it. Every split costs a network call, a deploy and a page at night; none of the parts has outgrown the database.",
      "A module talks to another through its functions, never its tables, so one can leave later without a rewrite.",
      { linkTo: [{ title: "Glossary: order, line, shipment", age: 380 }] },
    ),
    d(
      "app",
      "Orders are never deleted; they are cancelled",
      "A cancelled order keeps its lines, its payments and its invoice; nothing in the orders tables is ever removed.",
      390,
      "An order moves to `cancelled` with a reason; its rows stay. The API has no delete for orders.",
      "Accounting needs every invoice number it ever issued, and support needs to see what a customer saw.",
      "Reports filter out cancelled orders; the archive job moves orders older than seven years, whole, to cold storage.",
    ),
    d(
      "app",
      "Totals are computed on the server",
      "The client sends what it wants to buy; the price, the taxes and the total come from the catalog at checkout.",
      370,
      "Checkout recomputes every line from the catalog and the customer's terms; a total sent by the client is ignored.",
      "A price in the client is a price anyone can edit, and the catalog changes while a cart sits open.",
      "A cart shows a total that may change at checkout, and the app says so when it does.",
    ),
    d(
      "app",
      "Payments go through one provider behind an interface",
      "One payment provider, reached only through the payments module, so changing it is one module's work.",
      350,
      "Every charge, refund and payout goes through the payments module, which talks to one provider.",
      "Two providers doubled the reconciliation for a few points of fees; one interface keeps a change possible.",
      "The provider's webhooks land in the payments module alone.",
    ),
    d(
      "app",
      "Invoices are numbered without gaps per year",
      "Each year's invoices run 1, 2, 3… with no gap, as the tax office asks; the number is taken when the invoice is issued.",
      320,
      "An invoice takes its number from a per-year counter in the same transaction that issues it.",
      "A gap in the sequence is a question from the auditors; a number taken earlier, at order time, leaves gaps when orders are cancelled.",
      "Issuing an invoice is serialised per year; drafts have no number.",
    ),
    d(
      "app",
      "Stock is reserved when the order is paid",
      "Stock is held for an order only once its payment succeeds.",
      300,
      "The stock module reserves an order's lines when the payment provider confirms the charge.",
      "A reservation for an unpaid cart holds stock nobody may buy.",
      "Two customers can pay for the last unit; one of them is refunded.",
      {
        supersededBy: {
          title: "Stock is reserved when the cart checks out",
          summary: "Checkout holds the stock for fifteen minutes while the payment runs; an unpaid hold is released.",
          age: 60,
          source: ARCHITECTURE,
          evidence: "refunding the second buyer of the last unit cost more than a held cart",
          sections: {
            Decision:
              "Checkout reserves the lines for fifteen minutes; a confirmed payment keeps the reservation, a failed or late one releases it.",
            Why: "Refunding the second buyer of the last unit happened weekly in the sales, and each one was a support ticket and a lost customer.",
            Consequences: "A sweep releases expired holds every minute; the stock shown may be held, not sold.",
          },
        },
      },
    ),
    d(
      "app/api",
      "The public API is versioned in the path",
      "`/v1/…`, `/v2/…`: a partner chooses the version by the address it calls, and a version lives a year after the next one.",
      280,
      "The version is the first segment of the path. A version is supported for twelve months after its successor ships.",
      "Partners integrate once and forget; a version in the path is the one they cannot miss.",
      "Two versions run side by side; the partners page says who still calls the old one.",
      { linkTo: [{ title: "Partners who call the API", age: 100 }] },
    ),
    d(
      "app/api",
      "Webhooks are signed and retried for a day",
      "Every webhook carries an HMAC signature and is retried with backoff for twenty-four hours, then dropped and logged.",
      240,
      "Webhooks are signed with the partner's secret and retried with exponential backoff for a day.",
      "Partners' endpoints go down for hours; an unsigned call is one anybody can forge.",
      "A partner can replay a day of events from the dashboard; past that, from the export.",
    ),
    d(
      "app/data",
      "Reports read from the replica",
      "Every report and export queries the read replica, never the primary.",
      200,
      "Reports, exports and the dashboards connect to the replica; the primary serves the app alone.",
      "A month-end report once held a lock on the orders table for four minutes during checkout.",
      "A report may be a few seconds behind; the reporting page says how far.",
    ),
    d(
      "app/deploy",
      "Every deploy goes out behind a canary",
      "A new version takes 5% of traffic for ten minutes before the rest; the error rate decides.",
      150,
      "The pipeline sends 5% of traffic to the new version for ten minutes and promotes it only if errors and latency hold.",
      "The two worst incidents of the year were deploys everyone saw at once.",
      "A deploy takes fifteen minutes instead of five; a bad one reaches a twentieth of the customers.",
    ),
  ];

  const p = (
    ns: string,
    title: string,
    summary: string,
    age: number,
    when: string,
    steps: string,
    extra: Partial<PagePlan> = {},
  ): PagePlan => ({
    brain: B,
    kind: "knowledge",
    sub: "playbook",
    namespace: ns,
    title,
    summary,
    age,
    source: RUNBOOK,
    sections: { When: when, Steps: steps },
    ...extra,
  });
  const playbooks: PagePlan[] = [
    p(
      "app/deploy",
      "Deploy the app",
      "Merge to main, watch the canary, then announce it; the pipeline does the rest.",
      220,
      "A change is merged and its checks are green.",
      "1. Merge the pull request into `main`.\n2. The pipeline builds the image and runs the migrations first.\n3. Watch the canary dashboard for ten minutes.\n4. Announce the version in the deploys channel.",
      {
        edits: [
          {
            age: 40,
            section: "Steps",
            text: "1. Merge the pull request into `main`.\n2. The pipeline builds the image and runs the migrations first.\n3. Watch the canary dashboard for ten minutes; checkout's error rate is the one that matters.\n4. Announce the version in the deploys channel.",
            note: "Said which rate to watch.",
          },
        ],
      },
    ),
    p(
      "app/deploy",
      "Roll back a deploy",
      "Redeploy the previous image from the pipeline; a migration is never rolled back, the code is.",
      190,
      "The canary or production shows errors after a deploy.",
      "1. In the pipeline, redeploy the previous image.\n2. Leave the migrations alone: they are written to work with the previous code.\n3. Open an incident if customers saw errors.\n4. Write what happened in the deploys channel.",
    ),
    p(
      "app/data",
      "Run a migration before the deploy",
      "A migration ships in its own deploy, before the code that needs it, and works with the code already running.",
      170,
      "A change needs a new column, table or index.",
      "1. Write the migration so the running code ignores it: add, never rename or drop.\n2. Deploy it alone.\n3. Deploy the code that uses it.\n4. Drop what is unused in a later deploy.",
    ),
    p(
      "app/deploy",
      "Ship a hotfix",
      "A branch from the deployed version, one fix, the same pipeline: a hotfix skips nothing but the queue.",
      20,
      "Production is broken and `main` holds changes that are not ready.",
      "1. Branch from the tag of the deployed version.\n2. Make the one fix, with its test.\n3. Run it through the same pipeline, canary included.\n4. Merge the branch back into `main`.",
    ),
    p(
      "app",
      "Reproduce a customer's order locally",
      "Load the anonymised copy of the order and its customer into the local database, then replay the request.",
      70,
      "Support sends an order that behaves oddly.",
      "1. `make seed ORDER=<number>` copies the order, its lines and its customer, anonymised.\n2. Start the app locally.\n3. Replay the request from the order's log.",
      { source: README, linkTo: [{ title: "Where things are in the app repository", age: 60 }] },
    ),
    p(
      "app/api",
      "Onboard a partner to the API",
      "A partner gets a sandbox key, then a production key once their test orders pass.",
      110,
      "A partner wants to send orders through the API.",
      "1. Create the partner in the admin, with its contact.\n2. Send a sandbox key and the API guide.\n3. Check their first ten test orders together.\n4. Issue the production key and add them to the partners page.",
      { source: README },
    ),
  ];

  const c = (
    ns: string,
    title: string,
    summary: string,
    age: number,
    body: string,
    extra: Partial<PagePlan> = {},
  ): PagePlan => ({
    brain: B,
    kind: "knowledge",
    sub: "context",
    namespace: ns,
    title,
    summary,
    age,
    source: README,
    sections: { "": body },
    ...extra,
  });
  const context: PagePlan[] = [
    c(
      "app",
      "Where things are in the app repository",
      "The modules under src, the migrations, the runbooks under docs and the pipeline's file.",
      300,
      "- `src/checkout`, `src/invoicing`, `src/stock`, `src/payments`: the modules.\n- `migrations/`: one file per change, in order.\n- `docs/architecture.md`: what shapes the app.\n- `docs/runbooks/`: deploys, rollbacks and incidents.\n- `pipeline.yaml`: build, migrate, canary, promote.",
      { renamedTo: { title: "Where things are in the app repository and its docs", age: 0 } },
    ),
    c(
      "app",
      "Glossary: order, line, shipment",
      "The words the app is built on.",
      420,
      "- **Order**: what a customer bought at one checkout.\n- **Line**: one product and its quantity in an order.\n- **Shipment**: the lines that leave the warehouse together; an order may have several.\n- **Hold**: stock reserved for an order that is not paid yet.",
    ),
    c(
      "app",
      "Who works on the app",
      "Ana leads it; Diego and Lucía own the API and the data; Marco runs the deploys.",
      400,
      "Ana leads the app and decides what it does. Diego owns the API and the partners, Lucía the database and the reports, Marco the pipeline and the deploys. Northwind's warehouse team is the app's first user and says what hurts.",
    ),
    c(
      "app/deploy",
      "The environments of the app",
      "Production, staging, and a preview per pull request that lives until the merge.",
      50,
      "- **Production**: the customers' app, deployed from `main` behind a canary.\n- **Staging**: `main` before production, with yesterday's anonymised data.\n- **Previews**: one per pull request, with seed data, gone at the merge.",
      { source: RUNBOOK },
    ),
    c(
      "app/api",
      "Partners who call the API",
      "Acme and Globex send orders through the API; Initech pulls invoices every night.",
      120,
      "Acme and Globex create orders through `/v2/orders`; Globex still calls `/v1` for shipments. Initech pulls the day's invoices every night. Each partner has a contact in the admin; Diego knows them all.",
    ),
    c(
      "app/data",
      "The app runs on Postgres 14",
      "The primary and the replica run Postgres 14.",
      100,
      "The primary and its replica run Postgres 14 on the managed service; the upgrade window is Sunday morning.",
      {
        linkTo: [{ title: "The app is one service with one database", age: 0 }],
        retired: { age: 0, reason: "the database was upgraded to Postgres 16" },
      },
    ),
  ];

  const m = (
    ns: string,
    title: string,
    summary: string,
    age: number,
    what: string,
    lesson: string,
    thumb: string,
  ): PagePlan => ({
    brain: B,
    kind: "memory",
    namespace: ns,
    title,
    summary,
    age,
    source: session("northwind/app", age),
    evidence: what.split(";")[0]!.split(".")[0]!,
    sections: { "What happened": what, Lesson: lesson, "Rule of thumb": thumb },
  });
  const memories: PagePlan[] = [
    m(
      "app",
      "Rounding each line put invoices a cent off",
      "Rounding every line before adding them made some invoices disagree with the payment by a cent.",
      210,
      "Three hundred invoices in March were a cent off their payments; each line was rounded before the sum.",
      "Round once, on the total, and keep money in integer cents throughout.",
      "When two amounts disagree by a cent, look for rounding before anything else.",
    ),
    m(
      "app/api",
      "A partner retried on a timeout and doubled an order",
      "Acme's client retried a slow `POST /v2/orders` and the app created the order twice.",
      90,
      "Acme's client timed out after five seconds and sent the same order again; both were created and both were shipped.",
      "An endpoint that creates something must take an idempotency key.",
      "A retry is a second request unless the first one left a mark.",
    ),
    m(
      "app/deploy",
      "Staging's clock was an hour behind production",
      "A daylight-saving change reached production's hosts and not staging's; scheduled jobs ran an hour apart.",
      30,
      "The nightly invoice job ran at 01:00 in production and at midnight in staging for a week, so the two disagreed on the day's invoices.",
      "Run every host in UTC and convert at the edges.",
      "When two environments disagree about a day, compare their clocks first.",
    ),
    m(
      "app/data",
      "The nightly report locked the orders table",
      "A report run against the primary held a lock during checkout and slowed every order for four minutes.",
      210,
      "The month-end report ran on the primary with a long transaction; checkout waited on it for four minutes.",
      "Reports go to the replica, and long transactions never run on the primary.",
      "When checkout slows at a round hour, look for a job that started then.",
    ),
  ];

  const i = (
    ns: string,
    title: string,
    summary: string,
    age: number,
    when: string,
    doText: string,
    evidence: string,
    extra: Partial<PagePlan> = {},
  ): PagePlan => ({
    brain: B,
    kind: "memory",
    sub: "instinct",
    namespace: ns,
    title,
    summary,
    age,
    source: session("northwind/app", age),
    evidence,
    sections: { When: when, Do: doText },
    ...extra,
  });
  const instincts: PagePlan[] = [
    // Three occasions and not evolved yet: the report's Skill candidate.
    i(
      "app/data",
      "When a migration renames a column, ship it in two deploys",
      "Add the new column and write both, then drop the old one a deploy later.",
      160,
      "A change renames or retypes a column the running code reads.",
      "Ship the new column with code that writes both; move the reads; drop the old column in a later deploy.",
      "the rename broke the old pods during the canary",
      {
        occasions: [
          {
            age: 70,
            text: "split the customer email rename in two deploys",
            source: session("northwind/app", 70),
          },
          { age: 6, text: "same for the shipment status column", source: session("northwind/app", 6) },
        ],
      },
    ),
    i(
      "app/deploy",
      "When a deploy touches checkout, watch the canary to the end",
      "Checkout's errors show late; the ten minutes of the canary are the time to see them.",
      45,
      "A deploy changes anything under checkout.",
      "Stay on the canary dashboard for the whole ten minutes before promoting.",
      "a checkout error showed at minute eight of the canary",
      { occasions: [{ age: 12, text: "the discount change, same wait", source: session("northwind/app", 12) }] },
    ),
    i(
      "app",
      "When a refund fails, read the provider's dashboard before the logs",
      "The provider says why it refused; the app's logs only say that it did.",
      25,
      "A refund comes back failed.",
      "Open the payment in the provider's dashboard and read its reason first.",
      "the card had expired; the logs said only 'declined'",
    ),
  ];

  const ruleOf = (title: string, age: number, rule: string, why: string, evidence: string): PagePlan => ({
    brain: B,
    kind: "rule",
    namespace: "app",
    title,
    summary: rule,
    age,
    source: session("northwind/app", age),
    evidence,
    sections: { Rule: rule, Why: why },
  });
  const rules: PagePlan[] = [
    ruleOf(
      "Money is stored in integer cents",
      200,
      "Every amount is an integer number of cents, in the database, in the code and in the API; round once, on the total.",
      "Amounts in floating point, rounded line by line, once put three hundred invoices a cent off their payments.",
      'Ana: "no more floats for money, ever"',
    ),
    ruleOf(
      "An endpoint that creates something takes an idempotency key",
      85,
      "Every `POST` that creates an order, a refund or a shipment takes an `Idempotency-Key` header and answers a repeat with the first result.",
      "A partner's retry created and shipped the same order twice.",
      'Diego: "the key goes on every create, not only orders"',
    ),
    // Written after the playbook "Run a migration before the deploy" and saying what it says, and a Rule is saved
    // linked to nothing: the similar pages `brain lint` reports.
    ruleOf(
      "Run every migration before the deploy that needs it",
      15,
      "A migration ships in a deploy of its own, before the code that reads what it adds.",
      "Code that expected a column the database did not have yet took checkout down for twenty minutes.",
      'Marco: "migrations first, always, in their own deploy"',
    ),
  ];

  return [...decisions, ...playbooks, ...context, ...memories, ...instincts, ...rules];
}

// ---------------------------------------------------------------------------------------------------------------------
// team: Northwind's team, and the generator the brains share.

const SVC = [
  "billing",
  "auth",
  "search",
  "checkout",
  "notifications",
  "gateway",
  "scheduler",
  "reports",
  "inventory",
  "payments",
  "webhooks",
  "catalog",
  "ledger",
  "identity",
  "media",
  "analytics",
  "pricing-engine",
  "exports",
];
const TECH = [
  "Postgres 16",
  "Redis",
  "Kafka",
  "gRPC",
  "OpenTelemetry",
  "Terraform",
  "Next.js",
  "SQS",
  "Argo CD",
  "Pydantic",
  "Playwright",
  "pnpm workspaces",
  "ClickHouse",
  "Temporal",
  "Vault",
  "Cloudflare Workers",
  "dbt",
  "Sentry",
  "Vitest",
  "Bun",
  "NATS",
  "pgvector",
  "Prometheus",
  "Grafana",
  "Envoy",
  "Istio",
  "RabbitMQ",
  "Elasticsearch",
  "Snowflake",
  "Airflow",
  "Cypress",
  "Storybook",
  "Prisma",
  "Datadog",
];
const THING = [
  "new services",
  "queues",
  "background jobs",
  "feature flags",
  "infrastructure",
  "API contracts",
  "dashboards",
  "end-to-end tests",
  "the monorepo",
  "data migrations",
  "webhooks",
  "cron jobs",
  "secrets",
  "public APIs",
  "internal tools",
  "mobile releases",
];
const GOOD = [
  "small commits",
  "feature flags",
  "typed errors",
  "trunk-based flow",
  "explicit timeouts",
  "structured logs",
  "idempotent handlers",
  "one owner per service",
  "contract tests",
  "blue-green deploys",
  "read replicas for reports",
  "runbooks next to the code",
  "small PRs with screenshots",
  "async standups",
];
const BAD = [
  "big-bang releases",
  "long branches",
  "string errors",
  "implicit retries",
  "shared mutable config",
  "silent catches",
  "ad hoc cron jobs",
  "shared staging databases",
  "manual hotfixes",
  "copy-pasted configs",
  "Friday deploys",
  "undocumented env vars",
  "one giant migration",
];
const VERB = [
  "Deploy",
  "Roll back",
  "Rotate the credentials of",
  "Scale",
  "Migrate",
  "Debug",
  "Load-test",
  "Reindex",
  "Backfill",
  "Archive",
  "Benchmark",
  "Upgrade",
  "Decommission",
];
const OBJ = ["service", "database", "queue", "cache", "pipeline", "worker", "bucket", "index", "cluster"];
const PROB = [
  "outage",
  "latency spike",
  "data skew",
  "duplicate events",
  "stuck queue",
  "cert expiry",
  "leaked connection pool",
  "memory leak",
  "clock drift",
  "N+1 query storm",
  "retry storm",
  "disk full",
  "thundering herd",
  "schema drift",
  "lock contention",
  "cache stampede",
  "poison message",
  "hot partition",
  "stale replica",
  "orphaned jobs",
  "port exhaustion",
  "timezone drift",
  "partial deploy",
  "config skew",
  "slow consumer",
  "dead letter pile",
];
const ASPECT = [
  "ownership",
  "SLOs",
  "on-call rota",
  "environment variables",
  "data retention",
  "rate limits",
  "runbook location",
  "cost centre",
  "alert thresholds",
  "dashboards",
  "backup policy",
  "access list",
  "deploy window",
  "error budget",
  "escalation path",
  "release cadence",
  "data lineage",
  "feature owner",
  "incident template",
  "test fixtures",
  "vendor contact",
  "config source",
  "paging policy",
  "review checklist",
  "migration order",
  "sandbox limits",
];
const TRIG = [
  "the tests touch the database",
  "a PR changes an API contract",
  "a migration adds a column",
  "a deploy is after 16:00",
  "a dependency bumps a major",
  "a flag is older than 90 days",
  "an incident is declared",
  "a service has no owner",
  "a query scans a whole table",
  "a secret appears in a log",
  "a test is flaky twice",
  "a PR touches billing",
  "a queue's lag passes five minutes",
  "a release goes out on a holiday",
];
const ACT = [
  "run them serially",
  "ask for a contract review",
  "ship the migration before the code",
  "wait for the morning",
  "read the changelog first",
  "remove the flag",
  "open the incident channel first",
  "find the owner before touching it",
  "add the index before shipping",
  "rotate it the same hour",
  "quarantine it and open an issue",
  "ask finance to review",
  "page the owner",
  "freeze the release",
];
const PEOPLE = [
  "Ana",
  "Diego",
  "Lucía",
  "Marco",
  "Sofía",
  "Tomás",
  "Valeria",
  "Nico",
  "Inés",
  "Pablo",
  "Camila",
  "Jorge",
];
const CLIENTS = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne"];

const NS_OF: Record<string, string[]> = {
  engineering: SVC,
  platform: ["gateway", "scheduler", "infra", "ci", "observability", "secrets"],
  product: ["onboarding", "pricing", "search", "checkout", "mobile", "catalog"],
  operations: ["on-call", "incidents", "backups", "costs", "vendors", "runbooks"],
  security: ["auth", "secrets", "audit", "access", "dependencies", "pentest"],
  design: ["design system", "tokens", "forms", "empty states", "navigation", "accessibility"],
  people: ["onboarding", "hiring", "reviews", "holidays", "meetings", "pairing"],
  // the namespaces under another, each with the vocabulary of its own corner: one word each, and not the ones above, since
  // two titles that share two words read as one subject to `save` and `brain lint` (§1.4, §4.4)
  "engineering/backend": ["outbox", "sagas", "tenancy", "journal", "imports", "tombstones", "cursors", "fanout"],
  "engineering/frontend": ["hydration", "wizards", "bundling", "focus", "locales", "skeletons", "prefetch", "dialogs"],
  "platform/infrastructure": ["subnets", "bastions", "failover", "patching", "edge", "zones", "peering"],
  "platform/infrastructure/kubernetes": ["taints", "autoscaler", "probes", "ingress", "helm", "kubelet", "operators"],
  "platform/observability": ["tracing", "sampling", "synthetics", "cardinality", "spans", "exporters", "heatmaps"],
  "product/discovery": ["interviews", "concierge", "surveys", "prototypes", "cohorts", "churn"],
  "security/compliance": ["soc2", "questionnaires", "ceremonies", "exceptions", "samples", "tabletops", "dpa"],
  "design/system": ["spacing", "palettes", "sprites", "motion", "themes", "guidelines"],
  "people/hiring": ["scorecards", "loops", "offers", "referrals", "sourcing", "takehome"],
  "sam/tools": ["neovim", "tmux", "zsh", "aliases", "keymaps"],
  "sam/writing": ["drafts", "outlines", "newsletter", "essays"],
  "private/learning": ["rustlings", "papers", "theory", "queue", "courses"],
  app: ["checkout", "invoicing", "refunds", "shipping", "discounts", "returns"],
  "app/api": ["pagination", "partners", "versioning", "throttling", "idempotency", "callbacks"],
  "app/data": ["schema", "backfills", "replicas", "archiving", "reporting", "indexes"],
  "app/deploy": ["canaries", "previews", "pipelines", "runners", "artifacts", "freezes"],
};

import { significantWords, stemOf } from "../../src/core/index/text.ts";

const uniq = new Set<string>();
const seenStems: string[][] = [];
/** The stems of a title's significant words, the way `brain lint` and `save` compare pages (§1.4, §4.4). */
const stemsOfTitle = (t: string): string[] => [...new Set(significantWords(t).map(stemOf))];
/** Whether two titles are the same subject by that rule, either way round: two words in common and half of the shorter. */
const same = (a: string[], b: string[]): boolean => {
  const met = (x: string[], y: string[]) =>
    x.filter((s) => y.some((t) => t === s || (t.length >= 4 && s.startsWith(t)) || (s.length >= 4 && t.startsWith(s))))
      .length;
  const m = Math.max(met(a, b), met(b, a));
  return m >= 2 && m / Math.min(a.length, b.length) >= 0.5;
};
/** A title not used yet: the first form, then a longer one, so the vocabulary never runs dry in a way that shows. */
const fresh = (make: () => string, longer: () => string = () => `${make()} in ${pick(SVC)}`): string => {
  for (let tries = 0; tries < 400; tries++) {
    const t = tries < 200 ? make() : longer();
    const stems = stemsOfTitle(t);
    if (!uniq.has(t) && !seenStems.some((s) => same(s, stems))) {
      uniq.add(t);
      seenStems.push(stems);
      return t;
    }
  }
  throw new Error("the demo vocabulary ran out of titles");
};

function generated(
  brain: BrainName,
  namespaces: string[],
  counts: Record<string, number>,
  repos: string[],
  /** The titles of the pages written by hand in the same brain, which a generated one must not repeat. */
  taken: string[] = [],
): PagePlan[] {
  seenStems.length = 0; // titles are compared within a brain: a page is similar to its neighbours, not to another brain's
  for (const t of taken) seenStems.push(stemsOfTitle(t));
  const out: PagePlan[] = [];
  const ns = () => pick(namespaces);
  const topic = (n: string) => pick(NS_OF[n] ?? NS_OF[n.split("/")[0]!] ?? SVC);
  const src = (age: number) => session(pick(repos), age);
  const person = brain === "sam" ? "Sam" : pick(PEOPLE);
  /** Where a page comes from (§1.5): a session, with the person's words as evidence; or a document, where the source is enough. */
  const origin = (n: string, age: number, quote: string): { source: string; evidence?: string } =>
    chance(0.35)
      ? {
          source: chance(0.5)
            ? `https://wiki.northwind.example/${n}/${topic(n).replace(/\s+/g, "-")}`
            : `docs/runbooks/${topic(n).replace(/\s+/g, "-")}.md in ${pick(repos)}`,
        }
      : { source: src(age), evidence: quote };

  for (let k = 0; k < counts.decision!; k++) {
    const n = ns();
    const age = anAge();
    const title = fresh(() =>
      pick<() => string>([
        () => `${pick(TECH)} backs ${pick(THING)}`,
        () => `${pick(THING)} run on ${pick(TECH)}`,
        () => `Standardise ${pick(THING)} on ${pick(TECH)}`,
        () => `${pick(GOOD)} instead of ${pick(BAD)}`,
        () => `Adopt ${pick(TECH)} for ${pick(THING)}`,
        () => `${pick(GOOD)} for ${pick(THING)}`,
        () => `Retire ${pick(BAD)} in ${pick(SVC)}`,
        () => `${pick(SVC)} moves to ${pick(TECH)}`,
      ])(),
    );
    const plan: PagePlan = {
      brain,
      kind: "knowledge",
      sub: "decision",
      namespace: n,
      title,
      summary: `${title}.`,
      age,
      ...origin(n, age, `${person}: "${title.toLowerCase()}, that settles it"`),
      sections: {
        Decision: `${title}.`,
        Why: `${pick(BAD)} cost us a ${pick(PROB)} in ${topic(n)}; ${pick(GOOD)} did not.`,
        Consequences: `Applies to ${pick(THING)} from now on; existing ${topic(n)} moves when it is next touched.`,
      },
    };
    if (chance(0.2) && age > 30) {
      const nAge = Math.floor(age * r() * 0.8);
      const nTitle = fresh(() =>
        pick<() => string>([
          () => `${pick(TECH)} replaces the old choice for ${pick(THING)}`,
          () => `${pick(SVC)} settles on ${pick(TECH)}`,
        ])(),
      );
      plan.supersededBy = {
        title: nTitle,
        summary: `${nTitle}.`,
        age: nAge,
        ...origin(n, nAge, `${person}: "${nTitle.toLowerCase()} from now on"`),
        sections: {
          Decision: `${nTitle}.`,
          Why: `The earlier choice did not survive ${pick(PROB)} season.`,
          Consequences: `The old decision stays as history.`,
        },
      };
    }
    if (chance(0.15))
      plan.edits = [
        {
          age: Math.floor(age * r()),
          section: "Consequences",
          text: `Applies to ${pick(THING)}; ${topic(n)} and ${topic(n)} already moved.`,
          note: "Recorded where it already applies.",
        },
      ];
    out.push(plan);
  }
  for (let k = 0; k < counts.playbook!; k++) {
    const n = ns();
    const age = anAge();
    let t = topic(n);
    const title = fresh(
      () => ((t = topic(n)), chance(0.6) ? `${pick(VERB)} the ${t} ${pick(OBJ)}` : `Respond to a ${t} ${pick(PROB)}`),
    );
    out.push({
      brain,
      kind: "knowledge",
      sub: "playbook",
      namespace: n,
      title,
      summary: `${title}.`,
      age,
      ...origin(n, age, `${person}: "this is how we ${title.toLowerCase()}"`),
      sections: {
        When: `${pick(TRIG).replace(/^./, (c) => c.toUpperCase())}, or when ${person} asks.`,
        Steps: `1. Check ${pick(ASPECT)} of ${t}.\n2. ${pick(ACT).replace(/^./, (c) => c.toUpperCase())}.\n3. Announce it in the ${n} channel.\n4. Write the ${pick(ASPECT)} down if it changed.`,
      },
      ...(chance(0.2) && {
        edits: [
          {
            age: Math.floor(age * r()),
            section: "Steps",
            text: `1. Check ${pick(ASPECT)} of ${t}.\n2. ${pick(ACT).replace(/^./, (c) => c.toUpperCase())}.\n3. Announce it in the ${n} channel.\n4. Write the ${pick(ASPECT)} down if it changed.\n5. Close the loop with ${pick(PEOPLE)}.`,
            note: "Added the last step.",
          },
        ],
      }),
    });
  }
  for (let k = 0; k < counts.context!; k++) {
    const n = ns();
    const age = anAge();
    let t = topic(n);
    const title = fresh(
      () => ((t = topic(n)), chance(0.4) ? `${t} ${pick(ASPECT)}` : chance(0.5) ? `Who owns ${t}` : `Glossary: ${t}`),
    );
    out.push({
      brain,
      kind: "knowledge",
      sub: "context",
      namespace: n,
      title,
      age,
      ...origin(n, age, `${person}: "${t} is ${pick(PEOPLE)}'s; ask there first"`),
      summary: `${title}.`,
      ...(chance(0.25) && {
        aliases: [
          t
            .toUpperCase()
            .replace(/[^A-Z]/g, "")
            .slice(0, 3) || t,
        ],
      }),
      sections: {
        "": `${title}. ${pick(PEOPLE)} and ${pick(PEOPLE)} look after ${t} for ${pick(CLIENTS)}; the ${pick(ASPECT)} lives in the ${n} handbook. Ask in the ${n} channel before changing it.`,
      },
    });
  }
  for (let k = 0; k < counts.memory!; k++) {
    const n = ns();
    const age = anAge();
    let t = topic(n);
    const title = fresh(
      () => (
        (t = topic(n)),
        pick([
          () => `The ${t} ${pick(PROB)} came from ${pick(BAD)}`,
          () => `Restarting ${t} does not fix a ${pick(PROB)}`,
          () => `${t} logs say nothing about ${pick(ASPECT)}`,
          () => `A ${pick(PROB)} in ${t} looks like a ${pick(PROB)} at first`,
          () => `${pick(TECH)} hides a ${pick(PROB)} in ${t}`,
          () => `The ${t} ${pick(ASPECT)} were wrong for months`,
          () => `${t} only fails under ${pick(PROB)} load`,
        ])()
      ),
    );
    out.push({
      brain,
      kind: "memory",
      namespace: n,
      title,
      summary: `${title}.`,
      age,
      ...origin(n, age, `${person}: "${title.toLowerCase()}, again"`),
      sections: {
        "What happened": `${title}; it took an afternoon to see.`,
        Lesson: `Check ${pick(ASPECT)} of ${t} before blaming ${pick(TECH)}.`,
        "Rule of thumb": `If in doubt, look at staging before production.`,
      },
    });
  }
  for (let k = 0; k < counts.instinct!; k++) {
    const n = ns();
    const age = anAge();
    let trig = pick(TRIG);
    let act = pick(ACT);
    const title = fresh(
      () => ((trig = pick(TRIG)), (act = pick(ACT)), `When ${trig}, ${act}`),
      () => ((trig = pick(TRIG)), (act = pick(ACT)), `When ${trig} on ${pick(SVC)}, ${act}`),
    );
    const more = chance(0.45) ? 1 + (chance(0.3) ? 1 : 0) : 0;
    const occasions = Array.from({ length: more }, (_, j) => {
      const oAge = Math.max(0, Math.floor(age * (1 - (j + 1) / (more + 1))));
      return { age: oAge, text: `${act} again, on ${topic(n)}`, source: src(oAge) };
    });
    out.push({
      brain,
      kind: "memory",
      sub: "instinct",
      namespace: n,
      title,
      summary: `${act.replace(/^./, (c) => c.toUpperCase())} when ${trig}.`,
      age,
      source: src(age),
      evidence: `${trig} on ${topic(n)}; ${act}`,
      sections: {
        When: `${trig.replace(/^./, (c) => c.toUpperCase())}.`,
        Do: `${act.replace(/^./, (c) => c.toUpperCase())}.`,
      },
      ...(occasions.length > 0 && { occasions }),
      ...(more >= 1 && chance(0.4) && { evolveAge: Math.max(0, Math.floor((occasions.at(-1)?.age ?? age) * 0.5)) }),
    });
  }
  const RULES: [string, string][] =
    brain === "app"
      ? [] // written by hand, in `appPages`
      : brain === "sam"
        ? [
            [
              "Answer in Spanish; code and docs in English",
              "Sam thinks in Spanish; everything that lands in a repository is read by people who do not.",
            ],
            ["Give one recommendation, not a survey", "A list of options without a pick hands the work back."],
            ["Ask before force-pushing a shared branch", "A rewritten shared branch cost a morning in acme-web once."],
          ]
        : [
            [
              "Never commit secrets or tokens",
              "A leaked token in billing-svc meant rotating every credential over a weekend.",
            ],
            ["Run the tests before every commit", "Red main blocks everyone; a local run costs a minute."],
            ["Keep changes small and reviewable", "Reviews of more than 400 lines get rubber-stamped."],
            ["Name the source of every saved page", "A page nobody can check is a page nobody trusts."],
            [
              "Migrations run before the deploy",
              "Two rollbacks in September came from code expecting columns that were not there yet.",
            ],
            ["Do not edit generated files", "The next build throws the edit away without a word."],
          ];
  RULES.forEach(([title, why], k) => {
    const age = 300 + k * 15;
    out.push({
      brain,
      kind: "rule",
      namespace: namespaces[k % namespaces.length]!,
      title,
      summary: `${title}.`,
      age,
      source: src(age),
      evidence: `${person}: "${title.toLowerCase()}"`,
      sections: { Rule: `${title}.`, Why: why },
    });
  });
  const SKILLS =
    brain === "app"
      ? ["Refund an order"]
      : brain === "sam"
        ? ["Review before merge"]
        : ["Release checklist", "Triage an incident", "Postmortem template", "Dependency upgrade"];
  SKILLS.forEach((title) => {
    const age = anAge(300);
    out.push({
      brain,
      kind: "skill",
      namespace: ns(),
      title,
      summary: `${title}, step by step, run by the agent when it applies.`,
      age,
      source: `docs/skills/${title.toLowerCase().replace(/\s+/g, "-")}.md in ${pick(repos)}`,
      sections: {
        "When to use": `${pick(TRIG).replace(/^./, (c) => c.toUpperCase())}.`,
        Steps: `1. ${pick(ACT).replace(/^./, (c) => c.toUpperCase())}.\n2. Check ${pick(ASPECT)}.\n3. Tell ${pick(PEOPLE)}.`,
      },
    });
  });
  // A few deliberate links between pages of one namespace, on top of the ones `save --create` makes by itself.
  const byNs = new Map<string, PagePlan[]>();
  for (const p of out) byNs.set(p.namespace, [...(byNs.get(p.namespace) ?? []), p]);
  for (const pages of byNs.values()) {
    for (let k = 0; k < Math.min(10, Math.floor(pages.length / 2)); k++) {
      const a = pick(pages);
      const b = pick(pages);
      if (a !== b && !a.supersededBy)
        a.linkTo = [
          ...(a.linkTo ?? []),
          { title: b.title, age: Math.min(a.age, b.age) === 0 ? 0 : Math.floor(Math.min(a.age, b.age) * r()) },
        ];
    }
  }
  return out;
}

/** How many days a kind of page lasts without a change or a confirmation before `brain lint` asks. */
const WINDOW: Record<string, number> = { context: 270, playbook: 365, rule: 365, skill: 365, memory: 365 };

/**
 * What happened to the older pages afterwards: someone confirmed most of those past their window (a few are left, so
 * the report has something to say), a couple of pages were retired, and one fact carries a date after which it needs
 * a second look. Written through the verbs like everything else.
 */
function lifecycle(pages: PagePlan[]): PagePlan[] {
  for (const brain of ["sam", "team", "app"] as BrainName[]) {
    const mine = pages.filter((p) => p.brain === brain);
    let asking = 0;
    let retired = 0;
    mine.forEach((p, idx) => {
      if (p.supersededBy !== undefined || p.retired !== undefined || p.renamedTo !== undefined) return;
      if (brain !== "app" && retired < 2 && p.sub === "context" && p.age > 80 && idx % 4 === 1) {
        p.retired = { age: Math.floor(p.age * 0.3), reason: "the team that owned it was reorganised" };
        retired++;
        return;
      }
      const window = WINDOW[p.sub ?? p.kind];
      if (window === undefined || p.age <= window) return;
      if (asking < 3 && idx % 5 === 0) {
        asking++;
        return;
      }
      p.verifiedAge = Math.floor(p.age * 0.4);
    });
  }
  // Later things: instincts that became a Rule or a playbook, a memory of the personal brain that went to the team,
  // and two decisions of the team that nobody has reconciled.
  for (const brain of ["sam", "team"] as BrainName[]) {
    pages
      .filter((p) => p.brain === brain && p.sub === "instinct" && p.evolveAge !== undefined)
      .forEach((p, k) => {
        if (k % 3 === 1) p.evolveTo = "rule";
        else if (k % 3 === 2) p.evolveTo = "playbook";
      });
  }
  const mover = pages.find(
    (p) =>
      p.brain === "sam" &&
      p.kind === "memory" &&
      p.sub === undefined &&
      p.age > 120 &&
      p.retired === undefined &&
      p.verifiedAge === undefined,
  );
  if (mover !== undefined) {
    mover.promoted = { to: "team", age: Math.floor(mover.age * 0.3), sections: { ...mover.sections } };
    delete mover.verifiedAge;
  }
  const decisions = pages.filter(
    (p) =>
      p.brain === "team" &&
      p.sub === "decision" &&
      p.supersededBy === undefined &&
      p.retired === undefined &&
      p.age > 40,
  );
  const pair = decisions.find((a) => decisions.some((b) => b !== a && b.namespace === a.namespace));
  if (pair !== undefined) {
    const other = decisions.find((b) => b !== pair && b.namespace === pair.namespace)!;
    pair.contradicts = { title: other.title, age: Math.floor(Math.min(pair.age, other.age) * 0.4) };
  }
  // One page of the team brain without a summary, one past its date and one with a date to come.
  const team = pages.filter((p) => p.brain === "team" && p.sub === "context" && p.retired === undefined);
  if (team[4] !== undefined) delete team[4].summary;
  if (team[6] !== undefined) team[6].staleAfter = "2026-09-30";
  if (team[9] !== undefined) team[9].staleAfter = "2026-12-01";
  return pages;
}

/**
 * What the ingests of the project brain read: the app's architecture page at one commit, its deploy runbook at
 * another, and one page of the runbook read again at a later one, so `kioku brain sources` has a source whose pages do
 * not all agree. The pages from the README name no version, which is what a source ingested before the field looks like.
 */
function versions(pages: PagePlan[]): PagePlan[] {
  const app = pages.filter((p) => p.brain === "app");
  for (const p of app) {
    if (p.source === ARCHITECTURE) p.sourceVersion = "4d2a9e1";
    if (p.supersededBy?.source === ARCHITECTURE) p.supersededBy.sourceVersion = "4d2a9e1";
  }
  const runbook = app.filter((p) => p.source === RUNBOOK);
  for (const p of runbook) p.sourceVersion = "a91c3f0";
  const again = runbook
    .filter(
      (p) =>
        p.retired === undefined &&
        p.supersededBy === undefined &&
        p.renamedTo === undefined &&
        p.promoted === undefined,
    )
    .at(-1);
  if (again !== undefined) again.reread = { age: Math.max(0, Math.floor(again.age / 3)), version: "e5b72d4" };
  return pages;
}

export function plan(): PagePlan[] {
  // The team and sam first: the generator's sequence is shared, so the app's pages, drawn last, leave theirs as they were.
  const team = generated(
    "team",
    BRAINS.team.namespaces,
    { decision: 40, playbook: 28, context: 34, memory: 30, instinct: 18 },
    ["acme-api", "acme-web", "acme-platform", "billing-svc", "infra", "data-pipeline", "mobile-app", "ledger-svc"],
  );
  const sam = generated(
    "sam",
    BRAINS.sam.namespaces,
    { decision: 8, playbook: 6, context: 10, memory: 20, instinct: 14 },
    ["northwind/app", "dotfiles", "blog", "acme-api", "side-project"],
  );
  const byHand = appPages();
  const titles = byHand.flatMap((p) => [
    p.title,
    ...(p.supersededBy ? [p.supersededBy.title] : []),
    ...(p.renamedTo ? [p.renamedTo.title] : []),
  ]);
  const app = generated(
    "app",
    BRAINS.app.namespaces,
    { decision: 10, playbook: 8, context: 8, memory: 10, instinct: 8 },
    ["northwind/app"],
    titles,
  );
  return versions(lifecycle([...byHand, ...app, ...team, ...sam]));
}

/** What a namespace's `INDEX.md` says to read first in the project brain (`## Load first`), by page title. */
export const LOAD_FIRST: Record<string, string[]> = {
  app: [
    "Where things are in the app repository",
    "Glossary: order, line, shipment",
    "The app is one service with one database",
    "Money is stored in integer cents",
  ],
  "app/api": ["Partners who call the API", "The public API is versioned in the path"],
  "app/data": ["Run a migration before the deploy"],
  "app/deploy": ["Deploy the app", "The environments of the app"],
};

/** What a search of the project brain should answer: each question finds its page among the first five (`pnpm test:demo`). */
export const SEARCHES: { query: string; expect: string }[] = [
  { query: "how do I roll back a bad deploy", expect: "Roll back a deploy" },
  { query: "can an order be deleted", expect: "Orders are never deleted; they are cancelled" },
  { query: "how long is stock held at checkout", expect: "Stock is reserved when the cart checks out" },
  { query: "which partners call the API", expect: "Partners who call the API" },
];
