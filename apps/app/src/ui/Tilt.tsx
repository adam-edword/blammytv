import ReactParallaxTilt, { type ReactParallaxTiltProps } from "react-parallax-tilt";

/**
 * react-parallax-tilt, without its measure on mount.
 *
 * On mount the library appends its glare, reads the card's rect and writes
 * the glare's size: a forced layout per card, while the rest of the screen
 * is still being built. Discover's grid and Stream's rows mount hundreds of
 * cards, so it was hundreds of layouts in one task (the Live auditor's
 * worst measured cost: 1.1s of Discover's 1.4s open). The measure is only
 * needed to follow the pointer, and the library measures again on every
 * mouseenter anyway, so this skips the one in componentDidMount. At rest
 * nothing differs on screen: the tilt is flat and the glare's opacity is 0.
 * Measured on 300 cards: 142 to 227ms and 300 layouts, down to 38 to 48ms
 * and none.
 *
 * The window resize the library listens to still measures. Stream's hero
 * relies on it (it fires one after each slide), and it is where a card
 * that has never been hovered gets its first size now.
 *
 * `setSize` and `componentDidMount` are the library's public members;
 * verify-tilt fails if a version changes what they do.
 */
export class Tilt extends ReactParallaxTilt {
  private mounting = false;

  constructor(props: ReactParallaxTiltProps) {
    super(props);
    const measure = this.setSize;
    this.setSize = () => {
      if (!this.mounting) measure();
    };
  }

  componentDidMount() {
    this.mounting = true;
    try {
      super.componentDidMount();
    } finally {
      this.mounting = false;
    }
  }
}
