// ESLint flat config。用 @antfu/eslint-config(Vue/Vite 生态 Anthony Fu 的一体化配置,社区事实标准)。
// stylistic 匹配现有代码风格(分号 + 单引号 + 2 空格)。
import antfu from '@antfu/eslint-config';

export default antfu({
  vue: true,
  typescript: false, // 项目纯 JS
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: true,
  },
  ignores: ['dist/**', 'node_modules/**', 'tmp/**'],
});
