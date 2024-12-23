import Spinner from '@components/recipe-form/spinner';
import Form from '@components/recipe-form/Form';
import Layout, { MainContent } from '@components/layout'
import styles from './index.module.css';
import { useState, useRef } from 'react';
import Button from '@components/button';
import useFetch from 'use-http'
import PhotoIcon from '@components/svg/photo';

const NewRecipe = () => {
  const title = 'Add New Recipe';
  const [APIError, setAPIError] = useState(null);
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const imageInput = useRef(null);

  const { post, response, loading, error } = useFetch(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image`, { cachePolicy: 'no-cache' });

  const handleImageClick = () => {
    imageInput.current.click();
  }

  const handleImageChange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    const { result } = await post(formData);

    if (error || !response.ok) {
      if (response.status === 504) {
        setAPIError('Ran out of time processing image. Please try again.');
        return;
      }
      setAPIError('Failed to process image');
      return;
    }
    let {name, ingredients, instructions: method} = JSON.parse(result);
    let recipe = { name, ingredients, method, tags: [] }
    setParsedRecipe(recipe);
  };

  return (
    <Layout pageTitle={title}>
      <MainContent>
        <div className={styles.headerContainer}>
          <h1 className={styles.title}>{title}</h1>
          <input
            type="file"
            id="imageInput"
            accept="image/*"
            capture="environment"
            ref={imageInput}
            className={styles.fileInput}
            onChange={handleImageChange}
          />
          <Button className="" style="blue" onClick={handleImageClick}>
            <PhotoIcon className={styles.photoIcon} />
            { !!loading && <Spinner>Loading...</Spinner>}
          </Button>
        </div>
        { APIError && <p className={styles.error}>{APIError}</p> }
        {
          parsedRecipe ?
            <Form initialRecipe={parsedRecipe} mode="new"/> :
            <Form mode="new"/>
        }
      </MainContent>
    </Layout>
  )
}

export default NewRecipe
