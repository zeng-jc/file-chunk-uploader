export const Progress: React.FC<{ percent?: number | string }> = ({
  percent = 0,
}) => {
  return (
    <div className="flex items-center">
      <div className="progress-container bg-gray-300 w-[100%] h-2 rounded-full mr-2">
        <div
          className="progress-bar bg-blue-500 rounded-full h-2"
          style={{ width: Number(percent) + "%" }}
        ></div>
      </div>
      <span>{percent}%</span>
    </div>
  );
};

export default Progress;
