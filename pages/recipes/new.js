import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import styles from './index.module.css';

const NewRecipe = () => {
  const title = 'Add New Recipe';
  return (
    <Layout pageTitle={title}>
      <MainContent>
        <h1 className={styles.title}>{title}</h1>
        <Form />
      </MainContent>
    </Layout>
  )
}

export default NewRecipe
