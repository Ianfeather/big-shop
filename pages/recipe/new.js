import Form from '@components/recipe-form/Form';
import Layout from '@components/Layout'

const NewRecipe = ({ title, description, ...props }) => {
  return (
    <Layout pageTitle={title} description={description}>
      <h1 className="title">{title}</h1>
      <Form />
    </Layout>
  )
}

export default NewRecipe

export async function getStaticProps() {
  const configData = (await import(`../../siteconfig.json`)).default;

  return {
    props: {
      title: "Add New Recipe",
      description: configData.description,
    },
  }
}
