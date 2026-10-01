# Guestbook intake (Cloudflare Worker, free tier)

Lets visitors post without a GitHub account, while keeping bots out.

How a message travels: browser form -> Turnstile challenge -> this Worker (honeypot, minimum
fill time, link/keyword limits, 3 posts per IP per day) -> GitHub issue labelled `pending`.
The site only lists issues labelled `approved`, so nothing shows until you approve it.

## One-time setup
1. Cloudflare dashboard -> Turnstile -> add a widget for `irtiq7.github.io`. Copy the **site key** and **secret key**.
2. GitHub -> Settings -> Developer settings -> Fine-grained tokens: access to only `irtiq7/irtiq7.github.io`, permission **Issues: Read and write**. Copy the token.
3. In this folder:
   ```
   npx wrangler kv namespace create RATE      # paste the id into wrangler.toml
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler deploy                        # prints https://guestbook-intake.<you>.workers.dev
   ```
4. Put the Turnstile site key and the Worker URL into `../guestbook-config.js`, then commit and push.

## Moderating
- In the repo, open the `pending` issues. Add the label **approved** to publish one; close or delete spam.
- Your own questions: create an issue titled `[Question] ...` and add the `approved` label.
- Create the labels `pending` and `approved` once (Issues -> Labels).
