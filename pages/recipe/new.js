import Form from '@components/recipe-form/Form';
import Layout from '@components/layout';
import SingleColumnLayout from '@components/layout/single-column';

const NewRecipe = () => {
  const title = 'Add New Recipe';
  return (
    <Layout pageTitle={title}>
      <SingleColumnLayout>
        <h1 className="title bold">{title}</h1>
        <Form />
      </SingleColumnLayout>
    </Layout>
  )
}

export default NewRecipe
