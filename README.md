# Big Shop

A nextjs static site and a go api

## running the app
```
npm run dev
```
Requires node 14+

## backlog
The [bigshop Notion board](https://app.notion.com/p/87fae8a2ed054f2c874201e827639bd8) —
what is queued (`backlog`), designed (`spec written`), being built
(`in development`) and shipped (`done`). See CLAUDE.md's "Tracking work: the
Notion board" for how to work with it.

## deploying
This is handled automatically by netlify.

The lambda used to connect to planetscale DB. Since they dropped the free tier is connects to TiDB.

### local setup

Lots to do here.
- Setup netlify-lambda package for local dev
- Configure the app to connect to a local db

For running the UI:
- `npm run dev:full` brings up the database, the Go API and Next.js together
- Set `NEXT_PUBLIC_DISABLE_AUTH=true` in `.env.local` to skip Auth0 locally


### local db
To enter the mysql workspace:
```
mysql -u root
use bigshop;
```

- db user
```
CREATE USER 'admin'@'localhost' IDENTIFIED BY 'admin';
GRANT ALL PRIVILEGES ON bigshop.* TO 'admin'@'localhost';
```

#### Auth
The API is behind auth and I haven't come up with a nice way of configuring that yet for use via curl/postman. Via the app it's fine. For now I copy an authorization token from the application requests and use that in the auth header. Big todo.

## runnning db migrations
I haven't created a decent workflow for this yet :(

I've also been using workbench for dumping the db from prod to local.

## useful links
See [CLAUDE.md](./CLAUDE.md#useful-external-links).
