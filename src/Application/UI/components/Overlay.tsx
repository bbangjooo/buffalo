import React from "react";
import MuteToggle from "./MuteToggle";
function Overlay() {
  const musicCopyRight =
    "Soundtrack composed by AIVA (Artificial Intelligence Virtual Artist): https://www.aiva.ai";

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <p>{musicCopyRight}</p>
      </div>
      <div style={styles.ToggleRow}>
        <div style={styles.ToggleRowChild}>
          <MuteToggle />
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  container: {
    background: "black",
    color: "white",
    padding: 0,
    paddingLeft: 16,
    paddingRight: 16,
    textAlign: "center",
    display: "flex",
    marginBottom: 4,
    boxSizing: "border-box",
  },
  ToggleRow: {
    display: "flex",
    flexDirection: "row",
  },
  ToggleRowChild: {
    marginRight: 4,
  },
};

export default Overlay;
