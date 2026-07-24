import { MouseEventHandler } from 'react';
import styles from './index.module.css';
import Button from '@components/button';
import type { Invite as InviteModel } from '../../types/models';

interface InviteProps extends InviteModel {
  onAccept: MouseEventHandler;
  onReject: MouseEventHandler;
}

const Invite = ({token, account_holder: accountHolder, onAccept, onReject}: InviteProps) => (
  <div className={styles.invite}>
    <span>{accountHolder}:</span>
    <span>
      <Button style="primary" icon="tick" onClick={onAccept}>Accept</Button>
      <Button style="danger" icon="cross" onClick={onReject}>Reject</Button>
    </span>
  </div>
);

export default Invite;
