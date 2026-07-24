import styles from './index.module.css'

interface MessageProps {
  status: 'error';
  message: string;
}

const Message = ({ status, message }: MessageProps) => {
    return (
        <div className={`${styles.message} ${styles[status]}`}>
            {message}
        </div>
    )
}

export default Message;
