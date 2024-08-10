import React from "react";
import "./index.css"; // 引入样式文件

const Loading = () => {
  return (
    <div className="loading-container">
      <div className="center">
        <div className="loading-spinner mx-auto mb-2"></div>
        <div className="text-gray-100">文件解析中</div>
      </div>
    </div>
  );
};

export default Loading;
