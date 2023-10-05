import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EventBus } from "../EventBus";
import Overlay from "./Overlay";
import Intro from "./Intro/Intro";

interface InterfaceUIProps {}

const InterfaceUI: React.FC<InterfaceUIProps> = ({}) => {
  const [visible, setVisible] = useState(true);
  const [isIntro, setIsIntro] = useState(true);
  const interfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = document.getElementById("ui-interactive");
    if (element) {
      // @ts-ignore
      interfaceRef.current = element;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsIntro(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    EventBus.on("enterMonitor", () => {
      setVisible(false);
      if (interfaceRef.current) {
        interfaceRef.current.style.pointerEvents = "none";
      }
    });
    EventBus.on("leaveMonitor", () => {
      setVisible(true);
      if (interfaceRef.current) {
        interfaceRef.current.style.pointerEvents = "auto";
      }
    });
  }, []);

  return (
    <motion.div
      initial="hide"
      variants={vars}
      animate={visible ? "visible" : "hide"}
      style={styles.wrapper}
      className="interface-wrapper"
      id="prevent-click"
    >
      <>
        <Intro visible={isIntro} />
        <Overlay />
      </>
    </motion.div>
  );
};

const vars = {
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.5,
      delay: 0.3,
      ease: "easeOut",
    },
  },
  hide: {
    x: -32,
    opacity: 0,
    transition: {
      duration: 0.3,
      ease: "easeOut",
    },
  },
};

interface StyleSheetCSS {
  [key: string]: React.CSSProperties;
}

const styles: StyleSheetCSS = {
  wrapper: {
    width: "100%",
    height: "100%",
    display: "flex",
    // position: "absolute",
    boxSizing: "border-box",
  },
};

export default InterfaceUI;
