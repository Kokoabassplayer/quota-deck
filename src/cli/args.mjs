const COMMANDS = new Set(["setup", "doctor", "uninstall", "help"]);

export function parseArguments(argv) {
  const values = [...argv];
  const first = values[0] && !values[0].startsWith("-") ? values.shift() : "help";
  const command = first === "--help" || first === "-h" ? "help" : first;
  if (!COMMANDS.has(command)) throw cliError(`Unknown command: ${command}`, 64);

  const options = {
    command,
    check: false,
    json: false,
    nonInteractive: false,
    noOpen: false,
    yes: false,
    gatewayPort: 8787,
    codexBarPort: 8080,
  };

  while (values.length > 0) {
    const value = values.shift();
    if (value === "--check") options.check = true;
    else if (value === "--json") options.json = true;
    else if (value === "--non-interactive") options.nonInteractive = true;
    else if (value === "--no-open") options.noOpen = true;
    else if (value === "--yes" || value === "-y") options.yes = true;
    else if (value === "--help" || value === "-h") options.command = "help";
    else if (value === "--gateway-port") options.gatewayPort = parsePort(values.shift(), value);
    else if (value === "--codexbar-port") options.codexBarPort = parsePort(values.shift(), value);
    else throw cliError(`Unknown option: ${value}`, 64);
  }

  if (options.gatewayPort === options.codexBarPort) {
    throw cliError("Gateway and CodexBar ports must be different", 64);
  }
  return options;
}

function parsePort(value, flag) {
  if (!/^\d{1,5}$/u.test(value ?? "")) throw cliError(`${flag} requires a port`, 64);
  const port = Number(value);
  if (port < 1024 || port > 65535) throw cliError(`${flag} must be 1024-65535`, 64);
  return port;
}

function cliError(message, exitCode) {
  return Object.assign(new Error(message), { publicMessage: message, exitCode });
}
