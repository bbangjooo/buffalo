import React from "react";
import MuteToggle from "./MuteToggle";
function Overlay() {
  const githubLink = "https://github.com/bbangjooo/buffalo";

  return (
    <div style={styles.wrapper}>
      <div style={styles.underRow}>
        <div style={Object.assign({}, styles.container, styles.underRowChild)}>
          <a
            href={githubLink}
            target="_blank"
            style={{ textDecoration: "none" }}
          >
            <p>{"Source Code"}</p>
          </a>
        </div>
        <div style={styles.underRowChild}>
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
    padding: 4,
    fontSize: 14,
    paddingLeft: 16,
    paddingRight: 16,
    marginTop: 10,
    marginLeft: 10,
    textAlign: "center",
    display: "flex",
    marginBottom: 4,
    boxSizing: "border-box",
  },
  underRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  underRowChild: {
    marginRight: 4,
    marginBottom: 0,
    marginTop: 10,
  },
};

export default Overlay;
