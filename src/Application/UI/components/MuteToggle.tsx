import React, { useEffect, useState } from "react";
import { EventBus } from "../EventBus";
import { useCallback } from "react";
import { motion } from "framer-motion";
// @ts-ignore
import volumeOn from "../volume_on.svg";
// @ts-ignore
import volumeOff from "../volume_off.svg";

function MuteToggle() {
  const [hovering, setHovering] = useState(false);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(true);

  const onMouseDownHandler = useCallback(
    (event: any) => {
      event.preventDefault();
      setMuted(!muted);
      setActive(true);
    },
    [muted]
  );
  const onMouseUpHandler = useCallback(() => {
    setActive(false);
  }, []);
  useEffect(() => {
    EventBus.dispatch("muteToggle", muted);
  }, [muted]);
  return (
    <div
      onMouseDown={onMouseDownHandler}
      onMouseUp={onMouseUpHandler}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="icon-control-container"
      style={styles.container}
      id="prevent-click"
    >
      <motion.img
        id="prevent-click"
        src={muted ? volumeOff : volumeOn}
        style={{ opacity: active ? 0.2 : hovering ? 0.8 : 1 }}
        width={window.innerWidth < 768 ? 8 : 10}
        animate={active ? "active" : hovering ? "hovering" : "default"}
        variants={iconVars}
      />
    </div>
  );
}

const iconVars = {
  hovering: {
    // scale: 1.2,
    opacity: 0.8,
    transition: {
      duration: 0.1,
      ease: "easeOut",
    },
  },
  active: {
    scale: 0.8,
    opacity: 0.5,
    transition: {
      duration: 0.1,
      ease: [0.05, 0.7, 0.1, 1],
    },
  },
  default: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    background: "black",
    textAlign: "center",
    display: "flex",
    boxSizing: "border-box",
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
  },
};

export default MuteToggle;
