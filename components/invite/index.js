import styles from './index.module.css';
import Button from '@components/button';

const Invite = ({token, account_holder: accountHolder, onAccept, onReject}) => (
  <div className={styles.invite}>
    <span>You've been invited by {accountHolder}.</span>
    <span>
      <Button style="green" icon="tick" onClick={onAccept}>Accept</Button>
      <Button style="red" icon="cross" onClick={onReject}>Reject</Button>
    </span>
  </div>
);

export default Invite;
