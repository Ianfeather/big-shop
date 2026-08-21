// Hand-written because e2e/instance.cjs is plain CommonJS JavaScript and the
// e2e tsconfig does not enable allowJs. Values only - the shape is four
// constants, and duplicating four type annotations is cheaper than turning JS
// checking on for the whole e2e project.
declare const instance: {
  COMPOSE_PROJECT_NAME: string;
  WEB_PORT: number;
  DB_PORT: number;
  API_PORT: number;
};
export = instance;
