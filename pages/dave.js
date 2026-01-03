import styles from './dave.module.css';
import { useState, useEffect } from 'react';
import { useAuth0 } from "@auth0/auth0-react";
import Layout, { MainContent, Sidebar } from '@components/layout'
import DaveChat from '@components/dave-chat';
import useRecipes from '@hooks/use-recipes';

const Dave = () => {
  const [recipes] = useRecipes();
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "Hi! I'm Dave, your personal meal planning assistant. I can help you plan meals, suggest recipes from your collection, and create shopping lists. What would you like to cook this week?",
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const { user, getAccessTokenSilently } = useAuth0();

  const sendMessage = async (userMessage) => {
    // Add user message to conversation
    const userMessageObj = {
      id: Date.now(),
      role: 'user', 
      content: userMessage,
      timestamp: new Date()
    };
    
    const updatedMessages = [...messages, userMessageObj];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Get auth token for API calls
      const token = await getAccessTokenSilently();
      
      // Send to Dave AI service (always local Next.js API routes)
      const response = await fetch('/api/dave/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages,
          userId: user?.sub,
          authToken: token
        })
      });
      
      const data = await response.json();
      
      if (data?.message) {
        const assistantMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.message.content,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error('Invalid response from Dave API');
      }
      
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  function addUserAccount() {
    const appState = localStorage.getItem('app_state');
    if (!appState) return;
    if (appState === 'login') {
      // User account setup logic if needed
      localStorage.removeItem('app_state');
    }
  }

  useEffect(() => { addUserAccount() }, [user]);

  return (
    <Layout pageTitle="Chat with Dave - Big Shop">
      <div className={styles.daveContainer}>
        <MainContent name="Chat with Dave">
          <DaveChat 
            messages={messages}
            onSendMessage={sendMessage}
            isLoading={isLoading}
          />
        </MainContent>
        <Sidebar name="Your Recipes">
          <div className={styles.recipesSidebar}>
            <p>You have {recipes.length} recipes available</p>
            <p>Dave can suggest recipes and help you plan meals using your collection.</p>
          </div>
        </Sidebar>
      </div>
    </Layout>
  )
}

export default Dave