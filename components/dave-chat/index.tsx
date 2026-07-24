import { KeyboardEvent, useState, useRef, useEffect } from 'react';
import styles from './index.module.css';

interface DaveMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | Date;
}

interface DaveChatProps {
  messages: DaveMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

const DaveChat = ({ messages, onSendMessage, isLoading }: DaveChatProps) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatTime = (timestamp: string | Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  };

  return (
    <div className={styles.chatContainer}>
      <div className={styles.messagesContainer}>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.message} ${
              message.role === 'user' ? styles.userMessage : styles.assistantMessage
            }`}
          >
            <div className={styles.messageHeader}>
              <span className={styles.messageRole}>
                {message.role === 'user' ? 'You' : 'Dave'}
              </span>
              <span className={styles.messageTime}>
                {formatTime(message.timestamp)}
              </span>
            </div>
            <div className={styles.messageContent}>
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className={`${styles.message} ${styles.assistantMessage}`}>
            <div className={styles.messageHeader}>
              <span className={styles.messageRole}>Dave</span>
            </div>
            <div className={styles.messageContent}>
              <div className={styles.typingIndicator}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.inputContainer}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask Dave about meal planning, recipes, or shopping lists..."
            className={styles.messageInput}
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={styles.sendButton}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

export default DaveChat;