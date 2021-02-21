import styles from './index.module.css';

const Button = ({ className = '', onClick, children, ...props}) => {
  const classes = `${styles.button} ${className}`;

  return (
    <button className={classes} onClick={onClick}>
      {children}
    </button>
  )
}

export default Button;
