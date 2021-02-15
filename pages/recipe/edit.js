import useFetch from 'use-http'
import Router from 'next/router'
import { useState, useEffect } from 'react';
import Form from '@components/recipe-form/Form';
import Layout from '@components/layout';
import SingleColumnLayout from '@components/layout/single-column';

const EditRecipe = () => {
  let [recipe, setRecipe] = useState({});
  const { get, response } = useFetch(process.env.NEXT_PUBLIC_API_HOST, {
    cachePolicy: 'no-cache'
  });
  const title = 'Edit Recipe';

  async function getRecipe() {
    const params = new URLSearchParams(document.location.search);
    const id = params.get('id')
    if (id) {
      const recipe = await get(`/recipe/${id}`)
      if (response.ok) setRecipe(recipe)
    } else {
      Router.push('/recipe/new');
    }
  }

  useEffect(() => { getRecipe() }, []);

  return (
    <Layout pageTitle={title}>
      <SingleColumnLayout>
        <h1 className="title bold">{title}</h1>
        <Form initialRecipe={recipe} mode="edit" />
      </SingleColumnLayout>
    </Layout>
  )
}

export default EditRecipe
