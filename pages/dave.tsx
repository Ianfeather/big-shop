import styles from './dave.module.css';
import { useState, useEffect } from 'react';
import useAuth0 from '@hooks/use-auth';
import Layout, { MainContent, Sidebar } from '@components/layout'
import DaveChat, { DaveMessage } from '@components/dave-chat';
import useRecipes from '@hooks/use-recipes';
import { daveTurn } from '../lib/analytics/events';

const Dave = () => {
  const [recipes] = useRecipes();
  const [messages, setMessages] = useState<DaveMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: "Hi! I'm Dave, your personal meal planning assistant. I can help you plan meals, suggest recipes from your collection, and create shopping lists. What would you like to cook this week?",
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const { user, getAccessTokenSilently } = useAuth0();

  const sendMessage = async (userMessage: string) => {
    // Add user message to conversation
    const userMessageObj: DaveMessage = {
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
        // Counted on an answer arriving, not on the question being sent: a turn
        // is an exchange, and a failed request is not one. No parameter carries
        // the message - #43's example question is "is Dave used more than three
        // months ago", which needs a count and nothing else.
        daveTurn();
        const assistantMessage: DaveMessage = {
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
      const errorMessage: DaveMessage = {
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