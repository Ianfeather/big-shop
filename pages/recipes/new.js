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
  const [errorDetails, setErrorDetails] = useState(null);
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const imageInput = useRef(null);

  const { post, response, loading, error } = useFetch(`${process.env.NEXT_PUBLIC_HOST}/api/recipe-image`, {
    cachePolicy: 'no-cache',
    timeout: 60000, // 60 second timeout
  });

  const handleImageClick = () => {
    imageInput.current.click();
  }

  const handleImageChange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    // Reset error states
    setAPIError(null);
    setErrorDetails(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setAPIError('Invalid file type');
      setErrorDetails('Please select an image file (JPEG, PNG, etc.).');
      return;
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      setAPIError('Image too large');
      setErrorDetails('Please select an image smaller than 5MB.');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const { result, error, details } = await post(formData);

      if (error) {
        setAPIError(error);
        setErrorDetails(details);
        return;
      }

      if (!response.ok) {
        if (response.status === 504) {
          setAPIError('Processing timeout');
          setErrorDetails('The image processing took too long. Please try again with a smaller or clearer image.');
          return;
        }
        setAPIError('Failed to process image');
        setErrorDetails('An unexpected error occurred. Please try again.');
        return;
      }

      let {name, ingredients, instructions: method} = JSON.parse(result);
      let recipe = { name, ingredients, method, tags: [] }
      setParsedRecipe(recipe);
    } catch (error) {
      setAPIError('Failed to process image');
      setErrorDetails('An unexpected error occurred. Please try again.');
    }
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
            { !!loading && <Spinner>Processing image...</Spinner>}
          </Button>
        </div>
        { APIError && (
          <div className={styles.errorContainer}>
            <p className={styles.error}>{APIError}</p>
            { errorDetails && <p className={styles.errorDetails}>{errorDetails}</p> }
          </div>
        )}
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
