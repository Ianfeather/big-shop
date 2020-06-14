import Layout from '@components/Layout'

const Index = ({ title, description, ...props }) => {
  return (
    <Layout pageTitle={title} description={description}>
      <h1 className="title">{title}</h1>
    </Layout>
  )
}

export default Index

export async function getStaticProps() {
  const configData = (await import(`../../siteconfig.json`)).default;

  return {
    props: {
      title: "Add New Recipe",
      description: configData.description,
    },
  }
}
