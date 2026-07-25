declare module 'swagger-ui-react' {
  import { ComponentType } from 'react';

  const SwaggerUI: ComponentType<{ url?: string; spec?: object }>;
  export default SwaggerUI;
}
