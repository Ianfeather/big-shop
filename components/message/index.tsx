import styles from './index.module.css'

interface MessageProps {
  status: 'error';
  message: string;
}

// role="alert" so a screen reader announces it when it appears.
//
// Every use of this is a failure surfaced *after* an action - a save that did
// not save, a link that did not link - so it arrives asynchronously, some way
// from wherever focus is, and a message nobody is told about is one only sighted
// users get. Live rather than polite deliberately: the reader has just done
// something and is waiting to hear whether it worked.
const Message = ({ status, message }: MessageProps) => {
    return (
        <div className={`${styles.message} ${styles[status]}`} role="alert">
            {message}
        </div>
    )
}

export default Message;
