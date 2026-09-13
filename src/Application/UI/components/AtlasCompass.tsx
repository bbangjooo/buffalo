import React from 'react';
import { EventBus } from '../EventBus';
import { ROOM_IDS, ROOMS, RoomId } from '../../../design/rooms';
import './AtlasCompass.css';

type AtlasCompassProps = { room: RoomId; hidden: boolean; disabled: boolean };
const CARDINALS = ['N', 'E', 'S', 'W'];
const point = (angle: number, radius: number) => `${(100 + Math.sin(angle) * radius).toFixed(2)},${(100 - Math.cos(angle) * radius).toFixed(2)}`;

/** The rose is a room selector, not a live geographic heading. */
export default function AtlasCompass({ room, hidden, disabled }: AtlasCompassProps) {
  const selectedAngle = ROOMS[room].angle;
  const arcStart = point(selectedAngle - .25, 72);
  const arcEnd = point(selectedAngle + .25, 72);
  return <nav className="atlas-compass" aria-label="Room compass" hidden={hidden}>
    <svg className="atlas-compass-rose" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="64" />
      <circle cx="100" cy="100" r="68" />
      <circle className="atlas-compass-fine" cx="100" cy="100" r="72" />
      {Array.from({ length: 64 }, (_, index) => {
        const angle = index * Math.PI / 32;
        return <path key={`tick-${index}`} className="atlas-compass-tick" d={`M${point(angle, index % 4 === 0 ? 65.5 : 69)}L${point(angle, 72)}`} />;
      })}
      <circle className="atlas-compass-fine" cx="100" cy="100" r="42" />
      {Array.from({ length: 16 }, (_, index) => {
        const angle = index * Math.PI / 8;
        return <path key={`small-${index}`} className="atlas-compass-secondary" d={`M100,100L${point(angle - .12, 13)}L${point(angle, 44)}L${point(angle + .12, 13)}Z`} />;
      })}
      {Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI / 4;
        const tip = point(angle, index % 2 === 0 ? 61 : 47);
        return <g key={`point-${index}`}>
          <path className="atlas-compass-point atlas-compass-point--ink" d={`M100,100L${point(angle - .3, 15)}L${tip}Z`} />
          <path className="atlas-compass-point atlas-compass-point--paper" d={`M100,100L${tip}L${point(angle + .3, 15)}Z`} />
        </g>;
      })}
      <circle className="atlas-compass-hub" cx="100" cy="100" r="5" />
      <circle cx="100" cy="100" r="2" />
      <path className="atlas-compass-selected" d={`M${arcStart}A72,72 0 0,1 ${arcEnd}`} />
    </svg>
    {ROOM_IDS.map((id, index) => <button key={id} type="button" className="atlas-compass-link"
      style={{ left: `${50 + Math.sin(ROOMS[id].angle) * 43}%`, top: `${50 - Math.cos(ROOMS[id].angle) * 43}%` }}
      aria-label={ROOMS[id].name} title={ROOMS[id].name} aria-current={room === id ? 'page' : undefined}
      disabled={disabled} onClick={() => EventBus.dispatch('navigate', { view: id })}>
      <span className="atlas-compass-cardinal" aria-hidden="true">{CARDINALS[index]}</span>
      <span className="atlas-compass-tooltip" aria-hidden="true">{ROOMS[id].name}</span>
    </button>)}
    <span className="atlas-compass-current" aria-hidden="true">{ROOMS[room].name}</span>
  </nav>;
}
