# Project provenance

This project was created from [https://github.com/mbakaitis/cloudflare-workers-discord-template](https://github.com/mbakaitis/cloudflare-workers-discord-template) at version **1.0.0**, and `npm run setup` has already run.

This page exists to help you set up the new project you just created.  Note that it is different than in the original repo. You can go there and read why, if you want, but this is a copy for new repos and that's for maintaining the old one.

## What is still done by hand


### A. Create two Discord applications.

1. **Open the [Discord Developer Portal](https://discord.com/developers/applications)** and create your two new bots. 

    Name them so you can tell them apart, for example `Acme Bot (non-prod)` and `Acme Bot`.

    For each, you'll get connection data and tokens that are required but need to be kept safe. Each has an **Application ID** and a **Public Key**.  You don't need to write these down. You'll come back to each app and get these, later, as you set up the workers.

    *Note: This step can't be done in the Discord App! You **must** visit the developers website to create the bots.*

    *Note!: these are **not** Discord guilds (a.k.a. servers)! These are the bots that will be available in a guild.*

2. **Turn on developer mode.** 

    In your Discord App, open your personal account settings. You should see a `<> Developer` menu item OR you may need to look in `Advanced` settings. Toggle the Developer Mode to on.

3. **Create a test server (guild)**. 

    This is where your non-prod bot will be insatlled and available. 
    
    Later, you'll need the Guild ID. if you don't have developer mode enabled, you can't get the ID. Go back to step 2 if you skipped it.

4. **Install the test-bot onto the test-guild**.

    On the new test server you just created in step 3, add the bot to the server.  If you are unsure how to do this, see the [Discord Developer Docs](https://docs.discord.com/developers/quick-start/getting-started#setting-up-an-install-link) for more.

### Run it locally.

   No Cloudflare account is needed for development and testing.  You *will* need an account to deploy this to Cloudflare infrastructure.  
   
   You can work as long as you want on testing/dev or just to learn without a live Cloudflare account.  When you want to go live? You will need accounts.

   1. **Edit `.dev.vars`**:

        A. **Get the Application ID and Public Key** from your NON-production app.
        
        You find these via the [Discord Apps Portal](https://discord.com/developers/applications) for your NON-production bot.  These should be on the `General Information` screen.

        Use these values where indicated in the `.dev.vars` file.

        B. **Get your bot token.** This will be under the `Bot` menu screen. You'll get the new token with the `Reset Token` button. This erases your old token which should not matter if this is a new bot. But if you are trying to recycle an old bot or something, be sure of what you're doing before this step.

        Use the token where indicated in the `.dev.vars` file.

        C. **Get the Guild ID** via an open discord app window.  To get it, ensure you are in developer mode and then right-click on the guild icon. A `Copy Server Info -> Copy Guild ID` menu selection will get the Guild ID.

        Paste the guild ID into the indicated place in `.dev.vars`

  2. **Confirm local dev is working**

      ```sh
      npm run dev
      ```
      If there are unset variables, wrangler will *warn* about these.  They won't block the bot from starting.

      Opening the link wrangler creates on local dev start-up should return an `OK` message in a browser.

      `.dev.vars` is untracked, and it is read by `wrangler dev` on this machine and nowhere else. This only sets up a local environment. Worker secrets will be handled in a later step.

   3. **Confirm the guardrails still pass.** 

      The contract tests check that your two environments are distinct.

      ```sh
      npm test
      ```

   4. **Create the `develop` branch.** 

      Feature work merges into `develop`; releases go out from `main`.

      ```sh
      git switch -c develop
      git push -u origin develop
      ```

   5. **Set the Discord secrets on each Worker.** 

      *THIS* is where you need a Cloudflare account.  If you don't already have one, go get one. (Instructions for this are outside the scope of this repo.)

      The Worker reads three secrets, and each environment gets the values of **its own** Discord application:

      ```sh
      npx wrangler secret put DISCORD_PUBLIC_KEY --env non-prod
      npx wrangler secret put DISCORD_APPLICATION_ID --env non-prod
      npx wrangler secret put DISCORD_TOKEN --env non-prod
      ```

      Repeat with `--env production`, using the production application's values. `wrangler.jsonc` declares these names, so a deploy that is missing one fails and says which. CI never sets them for you; this is a one-time manual step per environment.

      Nothing has deployed yet, so neither Worker exists in your account. Wrangler offers to create each one as a placeholder to hold the secret; answer yes, and step 7's first deploy replaces the placeholder with your real code. These are separate from the `.dev.vars` values in step 1 — see [Where each value goes](using-this-template.md#where-each-value-goes).

   6. **Turn on deployment.** 

      With a working Cloudflare account:
      - Obtain your Cloudflare API token and account ID from your Cloudflare account.  *KEEP THESE SECRET!*

         If you have the [GitHub CLI](https://cli.github.com) signed in, one command creates the environments, their branch restrictions, and the branch ruleset, then reads all of it back and reports anything GitHub did not save:

         ```sh
         npm run setup:github -- --dry-run   # print every gh command, run none
         npm run setup:github                # apply, leaving deployment disabled
         npm run setup:github -- --enable-deploy
         ```

         It never sets a secret **value** — it reports which secret *names* are missing. Add the values yourself, either in the web interface below or with `gh secret set`. Unlike `npm run setup`, this script stays in your project: re-running it is how you re-check these settings later.

         To do all of it by hand instead 
      
         - in GitHub, open "Settings" in the top menu bar in the repo

         - open the "Environments" from the side menu in Settings

         - create environments for `production` and `non-prod`

         - add Cloudflare and Discord secrets to *each* environment. These will be the same for both, but each environment needs them repeated.

            - add the Cloudflare API token and account ID as secrets.  The secret name MUST be named like this:

               - `CLOUDFLARE_ACCOUNT_ID`
               - `CLOUDFLARE_API_TOKEN`
            
            You will need to get the API token and account ID from your Cloudflare dashboard.

            - add  Discord secrets to each environment. these will be *different* for each environment. 
            
               the test guild bot secrets are used only for the non-prod environment. 
               
               production environment will use the production bot:

               - `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` are needed on both environments, using the test/production bot secrets for non-prod/production
               - `DISCORD_GUILD_ID` is needed on `non-prod` only — production registers globally

         - finally, we add the non-secret *variable* (not a secret!)

            - create a repo (NOT branch) variable called `DEPLOY_ENABLED` 
            
            - if you are ready to start automatic deployments, set the variable to true

            - if you aren't ready, you should set the variable to `false`.  note that this a global repo variable!

            - if you set this to `true`, on the next push or PR merge that branch **will** automatically register new interactions with Discord and push the new code to the Worker to be live/available to that environment

   7. **Run a merge to deploy to Discord**

      This is the step that creates your Workers and registers your commands — until now nothing has existed in your Cloudflare account except the secret placeholders from step 5.

      With DEPLOY_ENABLED set to true in GitHub variables, push anything to develop:

      ```sh
      git switch develop
      git commit --allow-empty -m "chore: first deploy"
      git push
      ```

      In GitHub, open the Actions tab in the repo and watch the Deploy Worker run. It lints, runs the tests, deploys --env non-prod, and then registers the commands to your test guild. If the run appears greyed out as skipped, DEPLOY_ENABLED is not set true — go back to step 6.

      The deploy step's log ends with your Worker's URL, something like https://fatebot-9000-non-prod.<your-subdomain>.workers.dev. Copy it; step 8 needs it.

      Your commands are registered now but will not work yet — Discord does not know where to send them until step 8. That is expected, and it is why the endpoint URL comes last: Discord refuses an endpoint URL that cannot answer a signed PING, so the Worker has to exist first.

      Production works the same way on a merge to main, with two differences: the production environment's approval gate pauses the run until a reviewer approves it, and registration is global rather than guild-scoped. Until you do that merge, the production Worker does not exist and has no URL — leave the production application's endpoint blank for now.

      To deploy by hand instead, npm run deploy:non-prod prints the same URL, but it does not register anything; follow it with npm run register:non-prod.

   8. **Point each Discord application at its Worker.** 

      This step only works *after* a deploy, because Discord sends a signed `PING` to the URL when you save it and refuses one that does not answer correctly. Take the `https://...workers.dev` URL the deploy printed, add `/interactions`, and paste it into that application's **General Information > Interactions Endpoint URL**.

      Each application gets the URL of its **own** Worker: the non-production application points at `...-non-prod`, production at `...-production`. See [Point each Discord application at its Worker](using-this-template.md#8-point-each-discord-application-at-its-worker).

   9. **Try the commands.** 

      The deploy already registered them, so invite the non-production bot to your test server and type `/` — `/ping`, `/echo`, and `/slow` should be listed, and now that step 8 is done, they answer.

      Guild-scoped commands appear instantly; global ones can take a moment to propagate. If you deployed by hand with `npm run deploy:*` instead of through the workflow, register by hand too with `npm run register:non-prod` or `npm run register:production`.

***Phew!  Done!***

## Adopting a later upstream change

There is no automatic sync. Fetch the template as a second remote, review the diff, and cherry-pick what you want:

```sh
git remote add upstream https://github.com/mbakaitis/cloudflare-workers-discord-template.git   # setup did this if no upstream existed
git fetch upstream
git log --oneline upstream/main
```

A repository created with **Use this template** shares no history with upstream, so there is no revision range to diff against. `package.json`'s `template.commit` records the upstream commit this project started from; everything after it in `git log upstream/main` is a candidate to cherry-pick.

Application code, bindings, and deployment topology are yours; upstream cannot know about them, so every adoption is a reviewed change.
