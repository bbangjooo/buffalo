import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EventBus } from "../EventBus";
import Overlay from "./Overlay";

interface InterfaceUIProps {}

const InterfaceUI: React.FC<InterfaceUIProps> = ({}) => {
  const [visible, setVisible] = useState(true);
  const interfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = document.getElementById("ui-interactive");
    if (element) {
      // @ts-ignore
      interfaceRef.current = element;
    }
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
      className="interface-wrapper"
      id="prevent-click"
    >
      <Overlay />
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

export default InterfaceUI;
