import { Children, useState } from 'react';
import useViewport from '@hooks/use-viewport';
import { Grid } from '../layout';

const Tabs = ({ children, className, maxWidth, buttonsClassName }) => {
  const { width } = useViewport();
  const [selected, setSelected] = useState(0);

  if (width > maxWidth) {
    return <Grid>{ children }</Grid>
  }

  return (
    <div>
      <div className={buttonsClassName}>
        {Children.map(children, (Child, i) => {
          return <button onClick={() => setSelected(i)} disabled={i === selected}>{Child.props.name}</button>
        })}
      </div>
      <div className={className}>
        { Children.map(children, (Child, i) => {
          return i === selected ? Child: false;
        })}
      </div>
    </div>
  )
}

export default Tabs;
