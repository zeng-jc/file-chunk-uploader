import { useEffect, useRef } from "react";

export const BallMoveAnimation: React.FC = () => {
  const ballRef = useRef<HTMLDivElement>(null);
  const direction = useRef(1); // 1 to right, -1 to left
  let animationFrameId: number;

  useEffect(() => {
    recursionAnimation(ballRef.current!);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const recursionAnimation = (ball: HTMLDivElement) => {
    const ballStyle = getComputedStyle(ball);
    const ballLeft = Number.parseInt(ballStyle.left);
    let newLeft = ballLeft + direction.current;
    if (newLeft >= 300) direction.current = -1;
    if (newLeft <= 0) direction.current = 1;
    ball.style.left = `${newLeft}px`;
    animationFrameId = requestAnimationFrame(() => recursionAnimation(ball));
  };

  return (
    <div className="relative h-[50px] w-[350px] border my-3">
      <div
        className="boll bg-red-400 w-[50px] h-[50px] rounded-full absolute"
        ref={ballRef}
      ></div>
    </div>
  );
};

export default BallMoveAnimation;
