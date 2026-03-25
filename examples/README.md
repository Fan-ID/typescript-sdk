# Examples

Full library documentation (methods, types, errors): **[`../README.md`](../README.md)**.

1. Build the package from `lib/`:

   ```bash
   npm run build
   ```

2. Copy the environment template and fill in real values:

   ```bash
   cp examples/.env.example examples/.env
   ```

3. Run a script with Node’s built-in env file loading (**Node 20.6+**):

   ```bash
   node --env-file=examples/.env examples/list-paid-campaigns.mjs
   ```

   Or load variables however you prefer (`export …`, `direnv`, your app’s dotenv, etc.) and run:

   ```bash
   node examples/list-paid-campaigns.mjs
   ```

There is no custom `.env` loader in this folder — use `--env-file` or your own tooling.
