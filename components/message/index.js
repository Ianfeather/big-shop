import styles from './index.module.css'

const Message = ({ status, message }) => {
    return (
        <div className={`${styles.message} ${styles[status]}`}>
            {message}
        </div>
    )
}

export default Message;
