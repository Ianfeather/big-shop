import { Children, ReactElement, useState } from 'react';
import useViewport from '@hooks/use-viewport';
import { Grid } from '../layout';

interface TabsProps {
  // Each child is expected to carry a `name` prop (used as its tab-button
  // label) — not a real HTML attribute, just this component's convention.
  children: ReactElement<{ name?: string }>[];
  className?: string;
  maxWidth: number;
  buttonsClassName?: string;
}

const Tabs = ({ children, className, maxWidth, buttonsClassName }: TabsProps) => {
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
