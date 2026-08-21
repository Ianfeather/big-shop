import { MouseEventHandler } from 'react';
import styles from './index.module.css';
import Button from '@components/button';
import type { Invite as InviteModel } from '../../types/models';

interface InviteProps extends InviteModel {
  onAccept: MouseEventHandler;
  onReject: MouseEventHandler;
  // Set for the invitation an emailed link pointed at, so it is findable when
  // the account holds more than one. The toast on /account names the inviter;
  // this is what makes that name resolve to a row on screen.
  highlighted?: boolean;
}

const Invite = ({token, account_holder: accountHolder, onAccept, onReject, highlighted = false}: InviteProps) => (
  <div className={`${styles.invite} ${highlighted ? styles.highlighted : ''}`}>
    <span>{accountHolder}:</span>
    <span>
      <Button style="primary" icon="tick" onClick={onAccept}>Accept</Button>
      <Button style="danger" icon="cross" onClick={onReject}>Reject</Button>
    </span>
  </div>
);

export default Invite;
