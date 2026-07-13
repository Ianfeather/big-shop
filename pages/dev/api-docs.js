import dynamic from 'next/dynamic';
import Layout, { MainContent } from '@components/layout';
import styles from './api-docs.module.css';

// This page only exists in development (see getServerSideProps below) - an
// interactive Swagger-like viewer for docs/openapi.yaml, which is itself
// generated from the Go API's own route/type definitions (see
// technical-architecture.md and follow-ups.md item 7) rather than hand
// written, so this always reflects what internal/pkg/app actually does.
export async function getServerSideProps() {
  if (process.env.NODE_ENV === 'production') {
    return { notFound: true };
  }
  return { props: {} };
}

// swagger-ui-react reaches for `window`/`document` on import, so it can only
// ever run client-side.
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

const ApiDocs = () => {
  return (
    <Layout pageTitle="API Docs">
      <MainContent fullHeight={false}>
        <div className={styles.page}>
          <h1>API Docs</h1>
          <p className={styles.intro}>
            Dev-only viewer for the Go API&apos;s OpenAPI spec. The spec itself is
            generated from <code>internal/pkg/app</code>&apos;s Huma route
            definitions, not hand-written - run{' '}
            <code>cd netlify-functions/recipes &amp;&amp; go run . openapi {'>'} ../../docs/openapi.yaml</code>{' '}
            to regenerate it after changing a route, then refresh this page.
          </p>
          <div className={styles.swaggerWrapper}>
            <SwaggerUI url="/api/dev/openapi-spec" />
          </div>
        </div>
      </MainContent>
    </Layout>
  );
};

export default ApiDocs;
