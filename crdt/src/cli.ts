const BASE_URL = process.env.CRDT_API_URL ?? "http://localhost:1212";

async function fetchJson(params: { path: string; method?: string; body?: Record<string, string | undefined> }): Promise<Record<string, unknown>> {
  const { path, method = "GET", body } = params;
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res.json() as Promise<Record<string, unknown>>;
}

async function readDoc(): Promise<void> {
  const data = await fetchJson({ path: "/api/doc" });
  const content = data.content as string;
  if (content === "") {
    console.log("(empty document)");
  } else {
    console.log(content);
  }
}

async function editDoc(params: { oldString: string; newString: string }): Promise<void> {
  const data = await fetchJson({
    path: "/api/doc/edit",
    method: "POST",
    body: { oldString: params.oldString, newString: params.newString },
  });

  if (data.success) {
    console.log("Edit applied successfully.");
  } else {
    console.error(`Edit failed: ${data.error}`);
    process.exit(1);
  }
}

async function insertDoc(params: { content: string; anchor?: string; position?: string }): Promise<void> {
  const data = await fetchJson({
    path: "/api/doc/insert",
    method: "POST",
    body: {
      content: params.content,
      anchor: params.anchor,
      position: params.position,
    },
  });

  if (data.success) {
    console.log("Insert applied successfully.");
  } else {
    console.error(`Insert failed: ${data.error}`);
    process.exit(1);
  }
}

async function statusDoc(): Promise<void> {
  const [docData, opsData] = await Promise.all([
    fetchJson({ path: "/api/doc" }),
    fetchJson({ path: "/api/doc/ops" }),
  ]);

  const sv = docData.stateVector as Record<string, number>;
  const opCount = opsData.count as number;

  console.log(`Operations: ${opCount}`);
  console.log("State vector:");
  for (const [clientId, clock] of Object.entries(sv)) {
    console.log(`  ${clientId}: ${clock}`);
  }
}

// --- Suggest commands ---

async function suggestEditDoc(params: { oldString: string; newString: string }): Promise<void> {
  const data = await fetchJson({
    path: "/api/doc/suggest/edit",
    method: "POST",
    body: { oldString: params.oldString, newString: params.newString },
  });

  if (data.success) {
    console.log(`Suggestion created: ${data.suggestionId}`);
  } else {
    console.error(`Suggest edit failed: ${data.error}`);
    process.exit(1);
  }
}

async function suggestInsertDoc(params: { content: string; anchor?: string; position?: string }): Promise<void> {
  const data = await fetchJson({
    path: "/api/doc/suggest/insert",
    method: "POST",
    body: {
      content: params.content,
      anchor: params.anchor,
      position: params.position,
    },
  });

  if (data.success) {
    console.log(`Suggestion created: ${data.suggestionId}`);
  } else {
    console.error(`Suggest insert failed: ${data.error}`);
    process.exit(1);
  }
}

interface SuggestionInfo {
  id: string;
  insertText: string;
  deleteText: string;
}

async function suggestList(): Promise<void> {
  const data = await fetchJson({ path: "/api/doc/suggestions" });
  const suggestions = (data.suggestions ?? []) as ReadonlyArray<SuggestionInfo>;

  if (suggestions.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  console.log(`${suggestions.length} pending suggestion(s):\n`);
  for (const s of suggestions) {
    console.log(`  ID: ${s.id}`);
    if (s.deleteText) console.log(`    Delete: "${s.deleteText}"`);
    if (s.insertText) console.log(`    Insert: "${s.insertText}"`);
    console.log();
  }
}

async function suggestAccept(params: { id: string }): Promise<void> {
  const data = await fetchJson({
    path: `/api/doc/suggest/${params.id}/accept`,
    method: "POST",
  });

  if (data.success) {
    console.log("Suggestion accepted.");
  } else {
    console.error(`Accept failed: ${data.error}`);
    process.exit(1);
  }
}

async function suggestReject(params: { id: string }): Promise<void> {
  const data = await fetchJson({
    path: `/api/doc/suggest/${params.id}/reject`,
    method: "POST",
  });

  if (data.success) {
    console.log("Suggestion rejected.");
  } else {
    console.error(`Reject failed: ${data.error}`);
    process.exit(1);
  }
}

async function suggestAcceptAll(): Promise<void> {
  const data = await fetchJson({ path: "/api/doc/suggestions" });
  const suggestions = (data.suggestions ?? []) as ReadonlyArray<SuggestionInfo>;

  if (suggestions.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  for (const s of suggestions) {
    await fetchJson({ path: `/api/doc/suggest/${s.id}/accept`, method: "POST" });
    console.log(`Accepted: ${s.id}`);
  }
  console.log(`${suggestions.length} suggestion(s) accepted.`);
}

async function suggestRejectAll(): Promise<void> {
  const data = await fetchJson({ path: "/api/doc/suggestions" });
  const suggestions = (data.suggestions ?? []) as ReadonlyArray<SuggestionInfo>;

  if (suggestions.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  for (const s of suggestions) {
    await fetchJson({ path: `/api/doc/suggest/${s.id}/reject`, method: "POST" });
    console.log(`Rejected: ${s.id}`);
  }
  console.log(`${suggestions.length} suggestion(s) rejected.`);
}

function printUsage(): void {
  console.log(`Usage:
  bun run cli read                                    Read document content
  bun run cli edit --old "text" --new "replacement"   Content-addressed replace
  bun run cli insert "text"                           Append text to end
  bun run cli insert "text" --anchor "ref" --position before|after
                                                      Insert relative to anchor
  bun run cli status                                  Show state vector and op count

  Suggestion mode:
  bun run cli suggest edit --old "x" --new "y"        Suggest a replace
  bun run cli suggest insert "text" [--anchor "ref"] [--position before|after]
                                                      Suggest an insert
  bun run cli suggest list                            List pending suggestions
  bun run cli suggest accept <id>                     Accept suggestion by ID
  bun run cli suggest reject <id>                     Reject suggestion by ID
  bun run cli suggest accept-all                      Accept all suggestions
  bun run cli suggest reject-all                      Reject all suggestions`);
}

// --- Argument parsing ---

function parseArgs(): { command: string; subcommand: string; args: Map<string, string>; positional: Array<string> } {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0] ?? "";

  // For "suggest" command, the subcommand is the next arg
  let startIdx = 1;
  let subcommand = "";
  if (command === "suggest") {
    subcommand = rawArgs[1] ?? "";
    startIdx = 2;
  }

  const args = new Map<string, string>();
  const positional: Array<string> = [];

  let i = startIdx;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rawArgs[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        args.set(key, value);
        i += 2;
      } else {
        args.set(key, "true");
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { command, subcommand, args, positional };
}

async function main(): Promise<void> {
  const { command, subcommand, args, positional } = parseArgs();

  switch (command) {
    case "read":
      await readDoc();
      break;

    case "edit": {
      const oldString = args.get("old");
      const newString = args.get("new");
      if (!oldString || newString === undefined) {
        console.error("Usage: bun run cli edit --old \"text\" --new \"replacement\"");
        process.exit(1);
      }
      await editDoc({ oldString, newString });
      break;
    }

    case "insert": {
      const content = positional[0];
      if (!content) {
        console.error("Usage: bun run cli insert \"text\" [--anchor \"ref\"] [--position before|after]");
        process.exit(1);
      }
      await insertDoc({
        content,
        anchor: args.get("anchor"),
        position: args.get("position"),
      });
      break;
    }

    case "status":
      await statusDoc();
      break;

    case "suggest":
      await handleSuggestCommand({ subcommand, args, positional });
      break;

    default:
      printUsage();
      break;
  }
}

async function handleSuggestCommand(params: {
  subcommand: string;
  args: Map<string, string>;
  positional: Array<string>;
}): Promise<void> {
  const { subcommand, args, positional } = params;

  switch (subcommand) {
    case "edit": {
      const oldString = args.get("old");
      const newString = args.get("new");
      if (!oldString || newString === undefined) {
        console.error("Usage: bun run cli suggest edit --old \"text\" --new \"replacement\"");
        process.exit(1);
      }
      await suggestEditDoc({ oldString, newString });
      break;
    }

    case "insert": {
      const content = positional[0];
      if (!content) {
        console.error("Usage: bun run cli suggest insert \"text\" [--anchor \"ref\"] [--position before|after]");
        process.exit(1);
      }
      await suggestInsertDoc({
        content,
        anchor: args.get("anchor"),
        position: args.get("position"),
      });
      break;
    }

    case "list":
      await suggestList();
      break;

    case "accept": {
      const id = positional[0];
      if (!id) {
        console.error("Usage: bun run cli suggest accept <id>");
        process.exit(1);
      }
      await suggestAccept({ id });
      break;
    }

    case "reject": {
      const id = positional[0];
      if (!id) {
        console.error("Usage: bun run cli suggest reject <id>");
        process.exit(1);
      }
      await suggestReject({ id });
      break;
    }

    case "accept-all":
      await suggestAcceptAll();
      break;

    case "reject-all":
      await suggestRejectAll();
      break;

    default:
      console.error(`Unknown suggest subcommand: "${subcommand}"`);
      printUsage();
      process.exit(1);
      break;
  }
}

main();
