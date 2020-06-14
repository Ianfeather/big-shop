import Layout from '@components/layout'

const EditRecipe = ({ title, description, ...props }) => {
  return (
    <Layout pageTitle={title} description={description}>
      <h1 className="title">{title}</h1>
    </Layout>
  )
}

export default EditRecipe

export async function getStaticProps() {
  const configData = (await import(`../../siteconfig.json`)).default;

  return {
    props: {
      title: "Edit Recipe",
      description: configData.description,
    },
  }
}
