// Font Awesome Free 7.3.1 图标(Icons: CC BY 4.0,https://fontawesome.com/license/free)。
// 逐个以 ?raw 内联 SVG,而不是引入 webfont:CSS 里的字体文件在单文件构建里无法内联,
// 导出页也拿不到 node_modules,内联字符串两边都能用。
import chevronDown from '@fortawesome/fontawesome-free/svgs/solid/chevron-down.svg?raw';
import chevronLeft from '@fortawesome/fontawesome-free/svgs/solid/chevron-left.svg?raw';
import chevronRight from '@fortawesome/fontawesome-free/svgs/solid/chevron-right.svg?raw';
import chevronUp from '@fortawesome/fontawesome-free/svgs/solid/chevron-up.svg?raw';
import circleQuestion from '@fortawesome/fontawesome-free/svgs/solid/circle-question.svg?raw';
import folderOpen from '@fortawesome/fontawesome-free/svgs/solid/folder-open.svg?raw';
import gear from '@fortawesome/fontawesome-free/svgs/solid/gear.svg?raw';
import image from '@fortawesome/fontawesome-free/svgs/solid/image.svg?raw';
import images from '@fortawesome/fontawesome-free/svgs/solid/images.svg?raw';
import layerGroup from '@fortawesome/fontawesome-free/svgs/solid/layer-group.svg?raw';
import pause from '@fortawesome/fontawesome-free/svgs/solid/pause.svg?raw';
import play from '@fortawesome/fontawesome-free/svgs/solid/play.svg?raw';
import rotateLeft from '@fortawesome/fontawesome-free/svgs/solid/rotate-left.svg?raw';
import tableColumns from '@fortawesome/fontawesome-free/svgs/solid/table-columns.svg?raw';

export const ICONS = {
  chevronDown,
  chevronLeft,
  chevronRight,
  chevronUp,
  circleQuestion,
  folderOpen,
  gear,
  image,
  images,
  layerGroup,
  pause,
  play,
  rotateLeft,
  tableColumns,
};
