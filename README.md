# Sim Spark Setup

Build a website for sim activation 

1. Enter ICCID

2. Activate the Sim 

Activate sim via API to Iot Consoles Connect

3. Wait for the assigned ip address

Loop to get the assigned IP, once acquired, go to next step

4. Show status to user ac Active

5. Show IP address

6. Apply custom firewall rules

Apply custom firewall rules to UR35 

7. Apply miscellaneous settings 

Apply the extra router commands to UR35 (only when enabled in Admin Settings)

8. Process complete 



Authentication is password for external , internal is okta

## Deploy to your own server

- **Interactive installation:** [Run the Ubuntu installer](deploy/INTERACTIVE-INSTALL.md) for the database, sign-in services, website and HTTPS.
- **Native installation on a GCP Ubuntu VM:** [Deployment instructions](deploy/GCP-UBUNTU.md) using Ubuntu services directly.
- **Standalone setup and acceptance checks:** [Deployment reference](deploy/README.md).

The standalone app requires an independent PostgreSQL-backed authentication/data stack, not just a database. Existing hosted accounts and records are not copied automatically.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

For independent development, use `bun run dev:standalone` with your own public backend configuration in `deploy/env/.env.local`. Only public `VITE_` values belong there; keep server secrets outside the repository. Production uses the private environment and commands in the deployment guide.

The default development/build configuration is retained for the hosted preview. Independent deployment uses the separate standard configuration. See [the independence audit](deploy/INDEPENDENCE-AUDIT.md) for remaining development-only references and verification limits.
