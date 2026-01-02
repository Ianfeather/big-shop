# Big Shop

A nextjs static site and a go api

## running the app
```
npm run dev
```
Requires node 14+

## backlog
https://trello.com/b/LnaGkQyG/bigshop

## deploying
This is handled automatically by netlify.

The lambda used to connect to planetscale DB. Since they dropped the free tier is connects to TiDB.

### local setup

Lots to do here.
- Setup netlify-lambda package for local dev
- Configure the app to connect to a local db

For running the UI:
- Disable auth by setting `behindAuth` to `false` in .env.local
- Turn on mocks with `useMocks`


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
- [netlify](https://app.netlify.com/sites/big-shop/overview)
- [TiDB](https://tidbcloud.com/console/clusters/10445360365857932862/sqleditor?orgId=1372813089209222715&projectId=1372813089454538934)
- [Auth0 (for managing user)](https://manage.auth0.com/dashboard/eu/dev-x-n37k6b/applications/HxkTOH3ZYxjbsgrVI4ii1CV2TQx7hk9G/settings)
