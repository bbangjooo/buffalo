import React, { useEffect } from "react";
import "./Intro.css";

interface Props {
  visible: boolean;
}

function Intro({ visible }: Props) {
  useEffect(() => {
    const timer1 = setTimeout(() => {
      for (let i = 1; i <= 3; i++) {
        const letter = document.getElementsByClassName(`letter${i}`);
        console.log(i);
        console.log(letter[0]);
        letter[0].getAnimations()[0].play();
      }
    }, 1000);

    const timer2 = setTimeout(() => {
      for (let i = 5; i <= 7; i++) {
        const letter = document.getElementsByClassName(`letter${i}`);
        console.log(i);
        console.log(letter[0]);
        letter[0].getAnimations()[0].play();
      }
    }, 1200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);
  return (
    <div className="background" style={{ opacity: visible ? 1 : 0 }}>
      <div className="content">
        <div className="letter1">
          <div className="B-del1 del"></div>
          <div className="B-del2 del"></div>
          <div className="B-del3 del"></div>
          <div className="B-del4 del"></div>
        </div>

        <div className="letter2">
          <div className="B-del1 del"></div>
          <div className="B-del2 del"></div>
          <div className="B-del3 del"></div>
          <div className="B-del4 del"></div>
        </div>

        <div className="letter3">
          <div className="A-del1 del"></div>
          <div className="A-del2 del"></div>
          <div className="A-del3 del"></div>
        </div>

        <div className="letter4">
          <div className="N-del1 del"></div>
          <div className="N-del2 del"></div>
          <div className="N-del3 del"></div>
        </div>

        <div className="letter5">
          <div className="C-del1-1 del"></div>
          <div className="C-del1-2 del"></div>
          <div className="C-del2 del"></div>
          <div className="C-del3 del"></div>
          <div className="C-del4 del"></div>
          <div className="C-del5 del"></div>
          <div className="C-del6 del"></div>
          <div className="C-del7 del"></div>
          <div className="C-del8 del"></div>
          <div className="C-del9 del"></div>
          <div className="C-del10 del"></div>
        </div>

        <div className="letter6">
          <div className="J-del1-2 del"></div>
          <div className="J-del2 del"></div>
          <div className="J-del4 del"></div>
          <div className="J-del6 del"></div>
          <div className="J-del1 del"></div>
        </div>

        <div className="letter7">
          <div className="C-del1-1 del"></div>
          <div className="C-del1-2 del"></div>
          <div className="C-del2 del"></div>
          <div className="C-del3 del"></div>
          <div className="C-del4 del"></div>
          <div className="C-del5 del"></div>
          <div className="C-del6 del"></div>
          <div className="C-del7 del"></div>
          <div className="O-del1-1 del"></div>
          <div className="O-del1-2 del"></div>
        </div>
      </div>
    </div>
  );
}

export default Intro;
