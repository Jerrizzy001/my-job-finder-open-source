# Security

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab → Advisories) on this repository, not in a public issue. Include steps to reproduce and the version or commit. You should hear back within a week.

## Scope

This is a local, single-user tool. Things we especially want to hear about:

- any way for a web page you visit to read from or write to the local server on 127.0.0.1 (it checks Host and Origin, needs JSON for writes, sends no CORS headers, and needs the extension token on extension routes);
- any way for the extension to submit a form, act without you pressing Fill, or talk to anything but 127.0.0.1;
- any adapter path that sends credentials, bypasses robots.txt or the host allowlist, or reads beyond its budget;
- a draft that gets past the verifier with an invented fact.

## Your secrets

Model API keys are read from environment variables and never written to disk by this project. The extension token is random, stored in your local database and in the extension's local storage, and only ever sent to 127.0.0.1.
