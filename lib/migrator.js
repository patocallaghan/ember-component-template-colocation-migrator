const fse = require("fs-extra");
const { readFileSync } = require('fs');
const path = require('path');
const glob = require("glob");
const JSParser = require('./js-parser');
const jsTraverse = require('@babel/traverse').default;
const { parse, traverse } = require('ember-template-recast');
const removeDirectories = require('remove-empty-directories');

function getLayoutNameTemplates(files) {
  console.info(`Checking if any component templates are used as templates of other components using \`layoutName\``);
  let names = files.map(file => {
    let content = readFileSync(file, 'utf8');
    return fileInLayoutName(content);
  }).filter(Boolean);
  return Array.from(new Set(names));
}

function fileInLayoutName(content) {
  let ast = JSParser.parse(content);
  let layoutName;
  jsTraverse(ast, {
    ClassProperty: function(path) {
      if (path.node.key.name === 'layoutName') {
        layoutName = path.node.key.value.value;
        path.stop();
      }
    },
    Property: function(path) {
      if (path.node.key.name === 'layoutName') {
        layoutName = path.node.value.value;
        path.stop();
      }
    },
  });
  return layoutName;
}

function getPartialTemplates(files) {
  console.info(`Checking if any component templates are used as partials`);
  let names = files.reduce((acc, file) => {
    let content = readFileSync(file, 'utf8');
    let partials = filesInPartials(content);
    return partials.length ? acc.concat(partials) : acc;
  }, [])
  .filter(Boolean)
  .filter(path => path.startsWith('components/'))
  return Array.from(new Set(names));
}

function filesInPartials(content) {
  let partials = [];
  const ast = parse(content);
  traverse(ast, {
    MustacheStatement(node) {
      if (node.path.original === 'partial') {
        partials.push(node.params[0].value);
      }
    },
  });
  return partials;
}

function moveFile(sourceFilePath, targetFilePath) {
  let targetFileDirectory = path.dirname(targetFilePath);
  if (!fse.existsSync(targetFileDirectory)) {
    console.info(`📁 Creating ${targetFileDirectory}`);
    fse.mkdirSync(targetFileDirectory, { recursive: true })
  }

  console.info(`👍 Moving ${sourceFilePath} -> ${targetFilePath}`);
  fse.renameSync(sourceFilePath, targetFilePath);
}

module.exports = class Migrator {
  constructor(options) {
    this.options = options;
  }

  async execute() {
    let sourceComponentTemplatesPath = path.join(this.options.projectRoot, 'app/templates/components');
    var sourceComponentTemplateFilePaths = glob.sync(`${sourceComponentTemplatesPath}/**/*.hbs`);

    let sourceComponentPath = path.join(this.options.projectRoot, 'app/components');
    let sourceComponentFilePaths = glob.sync(`${sourceComponentPath}/**/*.js`);
    let templatesWithLayoutName = getLayoutNameTemplates(sourceComponentFilePaths);
    if (templatesWithLayoutName.length) {
      sourceComponentTemplateFilePaths = sourceComponentTemplateFilePaths.filter(sourceTemplateFilePath => {
        let sourceTemplatePathInApp = sourceTemplateFilePath.slice(this.options.projectRoot.length); // '/app/templates/components/nested1/nested-component.hbs'
        let templatePath = sourceTemplatePathInApp.slice('app/templates/'.length); // '/nested1/nested-component.hbs'
        return !templatesWithLayoutName.includes(templatePath.slice(1).replace('.hbs', ''));
      });
    }

    let sourceTemplatesPath = path.join(this.options.projectRoot, 'app/templates');
    var sourceTemplateFilePaths = glob.sync(`${sourceTemplatesPath}/**/*.hbs`);
    let templatesInPartials = getPartialTemplates(sourceTemplateFilePaths);
    if (templatesInPartials.length) {
      sourceComponentTemplateFilePaths = sourceComponentTemplateFilePaths.filter(sourceTemplateFilePath => {
        let sourceTemplatePathInApp = sourceTemplateFilePath.slice(this.options.projectRoot.length); // '/app/templates/components/nested1/nested-component.hbs'
        if (/\/\-[\w\-]+\.hbs/.test(sourceTemplatePathInApp)) {
          sourceTemplatePathInApp = sourceTemplatePathInApp.replace('/-', '/');
        }
        let templatePath = sourceTemplatePathInApp.slice('app/templates/'.length); // '/nested1/nested-component.hbs'
        return !templatesInPartials.includes(templatePath.slice(1).replace('.hbs', ''));
      });
    }

    sourceComponentTemplateFilePaths.forEach(sourceTemplateFilePath => {
      let sourceTemplatePathInApp = sourceTemplateFilePath.slice(this.options.projectRoot.length); // '/app/templates/components/nested1/nested-component.hbs'
      let templatePath = sourceTemplatePathInApp.slice('app/templates/components/'.length); // '/nested1/nested-component.hbs'
      let targetTemplateFilePath = path.join(this.options.projectRoot, 'app/components', templatePath); // '[APP_PATH]/app/components/nested1/nested-component.hbs'
      moveFile(sourceTemplateFilePath, targetTemplateFilePath);
    });

    templatesWithLayoutName.sort().forEach(template => {
      console.info(`❌ Did not move '${template}' due to usage as "layoutName" in a component`);
    });
    templatesInPartials.sort().forEach(template => {
      console.info(`❌ Did not move '${template}' due to usage as a "partial"`);
    });

    if (templatesWithLayoutName.length) {
      removeDirectories(sourceComponentTemplatesPath);
    } else {
      await fse.remove(sourceComponentTemplatesPath)
    }
  }
}