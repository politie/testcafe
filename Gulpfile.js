const babel                = require('babel-core');
const gulp                 = require('gulp');
const gulpStep             = require('gulp-step');
const data                 = require('gulp-data');
const less                 = require('gulp-less');
const qunitHarness         = require('gulp-qunit-harness');
const git                  = require('gulp-git');
const mocha                = require('gulp-mocha-simple');
const mustache             = require('gulp-mustache');
const rename               = require('gulp-rename');
const webmake              = require('gulp-webmake');
const uglify               = require('gulp-uglify');
const ll                   = require('gulp-ll-next');
const clone                = require('gulp-clone');
const mergeStreams         = require('merge-stream');
const del                  = require('del');
const fs                   = require('fs');
const path                 = require('path');
const { Transform }        = require('stream');
const globby               = require('globby');
const open                  = require('open');
const connect              = require('connect');
const spawn                = require('cross-spawn');
const serveStatic          = require('serve-static');
const Promise              = require('pinkie');
const markdownlint         = require('markdownlint');
const minimist             = require('minimist');
const prompt               = require('gulp-prompt');
const functionalTestConfig = require('./test/functional/config');
const assignIn             = require('lodash').assignIn;
const yaml                 = require('js-yaml');
const childProcess         = require('child_process');
const listBrowsers         = require('testcafe-browser-tools').getInstallations;
const npmAuditor           = require('npm-auditor');
const checkLicenses        = require('./test/dependency-licenses-checker');
const packageInfo          = require('./package');
const getPublishTags       = require('./docker/get-publish-tags');


gulpStep.install();

ll
    .install()
    .tasks([
        'lint',
        'check-licenses'
    ])
    .onlyInDebug([
        'styles',
        'client-scripts',
        'client-scripts-bundle'
    ]);

const ARGS          = minimist(process.argv.slice(2));
const DEV_MODE      = 'dev' in ARGS;
const QR_CODE       = 'qr-code' in ARGS;
const BROWSER_ALIAS = ARGS['browser-alias'];

const CLIENT_TESTS_PATH        = 'test/client/fixtures';
const CLIENT_TESTS_LEGACY_PATH = 'test/client/legacy-fixtures';

const CLIENT_TESTS_SETTINGS_BASE = {
    port:            2000,
    crossDomainPort: 2001,

    scripts: [
        { src: '/async.js', path: 'test/client/vendor/async.js' },
        { src: '/hammerhead.js', path: 'node_modules/testcafe-hammerhead/lib/client/hammerhead.min.js' },
        { src: '/core.js', path: 'lib/client/core/index.min.js' },
        { src: '/ui.js', path: 'lib/client/ui/index.min.js' },
        { src: '/automation.js', path: 'lib/client/automation/index.min.js' },
        { src: '/driver.js', path: 'lib/client/driver/index.js' },
        { src: '/legacy-runner.js', path: 'node_modules/testcafe-legacy-api/lib/client/index.js' },
        { src: '/before-test.js', path: 'test/client/before-test.js' }
    ],

    configApp: require('./test/client/config-qunit-server-app')
};

const CLIENT_TESTS_SETTINGS        = assignIn({}, CLIENT_TESTS_SETTINGS_BASE, { basePath: CLIENT_TESTS_PATH });
const CLIENT_TESTS_LOCAL_SETTINGS  = assignIn({}, CLIENT_TESTS_SETTINGS);
const CLIENT_TESTS_LEGACY_SETTINGS = assignIn({}, CLIENT_TESTS_SETTINGS_BASE, { basePath: CLIENT_TESTS_LEGACY_PATH });

const CLIENT_TESTS_DESKTOP_BROWSERS = [
    {
        platform:    'Windows 10',
        browserName: 'microsoftedge'
    },
    {
        platform:    'Windows 10',
        browserName: 'chrome'
    },
    {
        platform:    'Windows 10',
        browserName: 'firefox'
    },
    {
        platform:    'Windows 10',
        browserName: 'internet explorer',
        version:     '11.0'
    },
    {
        platform:    'macOS 10.13',
        browserName: 'safari',
        version:     '11.1'
    },
    {
        platform:    'OS X 10.11',
        browserName: 'chrome'
    },
    {
        platform:    'OS X 10.11',
        browserName: 'firefox'
    }
];

const CLIENT_TESTS_MOBILE_BROWSERS = [
    {
        platform:    'Linux',
        browserName: 'android',
        version:     '6.0',
        deviceName:  'Android Emulator'
    },
    {
        platform:    'iOS',
        browserName: 'Safari',
        // NOTE: https://github.com/DevExpress/testcafe/issues/471
        // problem with extra scroll reproduced only on saucelabs
        // virtual machines with ios device emulators
        version:     '10.3',
        deviceName:  'iPhone 7 Plus Simulator'
    }
];

const CLIENT_TESTS_SAUCELABS_SETTINGS = {
    username:  process.env.SAUCE_USERNAME,
    accessKey: process.env.SAUCE_ACCESS_KEY,
    build:     process.env.TRAVIS_BUILD_ID || '',
    tags:      [process.env.TRAVIS_BRANCH || 'master'],
    name:      'testcafe client tests',
    timeout:   720
};

const CLIENT_TEST_LOCAL_BROWSERS_ALIASES = ['ie', 'edge', 'chrome', 'firefox', 'safari'];

const PUBLISH_TAGS = getPublishTags(packageInfo);
const PUBLISH_REPO = 'testcafe/testcafe';

const NODE_MODULE_BINS = path.join(__dirname, 'node_modules/.bin');

process.env.PATH = NODE_MODULE_BINS + path.delimiter + process.env.PATH + path.delimiter + NODE_MODULE_BINS;

let websiteServer = null;

gulp.task('audit', () => {
    return npmAuditor()
        .then(result => {
            process.stdout.write(result.report);
            process.stdout.write('\n');

            if (result.exitCode !== 0)
                throw new Error('Security audit failed');
        });
});

gulp.task('clean', () => {
    return del('lib');
});


// Lint
gulp.task('lint', () => {
    const eslint = require('gulp-eslint');

    return gulp
        .src([
            'examples/**/*.js',
            'docker/*.js',
            'src/**/*.js',
            'src/**/*.ts',
            'test/**/*.js',
            '!test/client/vendor/**/*.*',
            'Gulpfile.js'
        ])
        .pipe(eslint())
        .pipe(eslint.format(process.env.ESLINT_FORMATTER))
        .pipe(eslint.failAfterError());
});

// License checker
gulp.task('check-licenses', () => {
    return checkLicenses();
});

// Build

gulp.step('client-scripts-bundle', () => {
    return gulp
        .src([
            'src/client/core/index.js',
            'src/client/driver/index.js',
            'src/client/ui/index.js',
            'src/client/automation/index.js',
            'src/client/browser/idle-page/index.js'
        ], { base: 'src' })
        .pipe(webmake({
            sourceMap: false,
            transform: (filename, code) => {
                const transformed = babel.transform(code, {
                    sourceMap: false,
                    ast:       false,
                    filename:  filename,

                    // NOTE: force usage of client .babelrc for all
                    // files, regardless of their location
                    babelrc: false,
                    extends: path.join(__dirname, './src/client/.babelrc')
                });

                // HACK: babel-plugin-transform-es2015-modules-commonjs forces
                // 'use strict' insertion. We need to remove it manually because
                // of https://github.com/DevExpress/testcafe/issues/258
                return { code: transformed.code.replace(/^('|")use strict('|");?/, '') };
            }
        }))
        .pipe(gulp.dest('lib'));
});

gulp.step('client-scripts-templates-render', () => {
    const scripts = gulp
        .src([
            'src/client/core/index.js.wrapper.mustache',
            'src/client/ui/index.js.wrapper.mustache',
            'src/client/automation/index.js.wrapper.mustache',
            'src/client/driver/index.js.wrapper.mustache'
        ], { base: 'src' })
        .pipe(rename(file => {
            file.extname  = '';
            file.basename = file.basename.replace('.js.wrapper', '');
        }))
        .pipe(data(file => {
            const sourceFilePath = path.resolve('lib', file.relative + '.js');

            return {
                source: fs.readFileSync(sourceFilePath)
            };
        }))
        .pipe(mustache())
        .pipe(rename(file => {
            file.extname = '.js';
        }));

    const bundledScripts = scripts
        .pipe(clone())
        .pipe(uglify())
        .pipe(rename(file => {
            file.extname = '.min.js';
        }));

    return mergeStreams(scripts, bundledScripts)
        .pipe(gulp.dest('lib'));
});

gulp.step('client-scripts', gulp.series('client-scripts-bundle', 'client-scripts-templates-render'));

gulp.step('server-scripts-compile', () => {
    return childProcess
        .spawn('tsc -p src/tsconfig.json', { shell: true, stdio: 'inherit' });
});


// TODO: get rid of this step when we migrate to proper ES6 default imports
gulp.step('server-scripts-add-exports', () => {
    const transform = new Transform({
        objectMode: true,

        transform (file, enc, cb) {
            const fileSource = file.contents.toString();

            if (fileSource.indexOf('exports.default =') >= 0) {
                const sourceMapIndex = fileSource.indexOf('//# sourceMappingURL');
                const modifiedSource = fileSource.slice(0, sourceMapIndex) + 'module.exports = exports.default;\n' + fileSource.slice(sourceMapIndex);

                file.contents = Buffer.from(modifiedSource);
            }

            cb(null, file);
        }
    });

    return gulp
        .src([
            'lib/**/*.js',
            '!lib/client/**/*.js'
        ])
        .pipe(transform)
        .pipe(gulp.dest('lib'));
});

gulp.step('server-scripts', gulp.series('server-scripts-compile', 'server-scripts-add-exports'));

gulp.step('styles', () => {
    return gulp
        .src('src/**/*.less')
        .pipe(less())
        .pipe(gulp.dest('lib'));
});

gulp.step('templates', () => {
    return gulp
        .src([
            'src/**/*.mustache',
            '!src/**/*.js.wrapper.mustache'
        ])
        .pipe(gulp.dest('lib'));
});

gulp.step('images', () => {
    return gulp
        .src([
            'src/**/*.png',
            'src/**/*.ico',
            'src/**/*.svg'
        ])
        .pipe(gulp.dest('lib'));
});

gulp.step('package-content', gulp.parallel('server-scripts', 'client-scripts', 'styles', 'images', 'templates'));

gulp.task('fast-build', gulp.series('clean', 'package-content'));

gulp.task('build', DEV_MODE ? gulp.registry().get('fast-build') : gulp.parallel('lint', 'fast-build'));

// Test
gulp.step('test-server-run', () => {
    return gulp
        .src('test/server/*-test.js', { read: false })
        .pipe(mocha({
            timeout: typeof v8debug !== 'undefined' || !!process.debugPort ? Infinity : 2000 // NOTE: disable timeouts in debug
        }));
});

gulp.step('test-server-bootstrap', gulp.series('build', 'test-server-run'));

gulp.task('test-server', gulp.parallel('check-licenses', 'test-server-bootstrap'));

function testClient (tests, settings, envSettings, cliMode) {
    function runTests (env, runOpts) {
        return gulp
            .src(tests)
            .pipe(qunitHarness(settings, env, runOpts));
    }

    if (!cliMode)
        return runTests(envSettings);

    return listBrowsers().then(browsers => {
        const browserNames   = Object.keys(browsers);
        const targetBrowsers = [];

        browserNames.forEach(browserName => {
            if (CLIENT_TEST_LOCAL_BROWSERS_ALIASES.includes(browserName))
                targetBrowsers.push({ browserInfo: browsers[browserName], browserName: browserName });
        });

        return runTests({ browsers: targetBrowsers }, { cliMode: true });
    });
}

gulp.step('test-client-run', () => {
    return testClient('test/client/fixtures/**/*-test.js', CLIENT_TESTS_SETTINGS);
});

gulp.task('test-client', gulp.series('build', 'test-client-run'));

gulp.step('test-client-local-run', () => {
    return testClient('test/client/fixtures/**/*-test.js', CLIENT_TESTS_LOCAL_SETTINGS, {}, true);
});

gulp.task('test-client-local', gulp.series('build', 'test-client-local-run'));

gulp.step('test-client-legacy-run', () => {
    return testClient('test/client/legacy-fixtures/**/*-test.js', CLIENT_TESTS_LEGACY_SETTINGS);
});

gulp.task('test-client-legacy', gulp.series('build', 'test-client-legacy-run'));

gulp.step('test-client-travis-run', () => {
    const saucelabsSettings = CLIENT_TESTS_SAUCELABS_SETTINGS;

    saucelabsSettings.browsers = CLIENT_TESTS_DESKTOP_BROWSERS;

    return testClient('test/client/fixtures/**/*-test.js', CLIENT_TESTS_SETTINGS, saucelabsSettings);
});

gulp.task('test-client-travis', gulp.series('build', 'test-client-travis-run'));

gulp.step('test-client-travis-mobile-run', () => {
    const saucelabsSettings = CLIENT_TESTS_SAUCELABS_SETTINGS;

    saucelabsSettings.browsers = CLIENT_TESTS_MOBILE_BROWSERS;

    return testClient('test/client/fixtures/**/*-test.js', CLIENT_TESTS_SETTINGS, saucelabsSettings);
});

gulp.task('test-client-travis-mobile', gulp.series('build', 'test-client-travis-mobile-run'));

gulp.step('test-client-legacy-travis-run', () => {
    const saucelabsSettings = CLIENT_TESTS_SAUCELABS_SETTINGS;

    saucelabsSettings.browsers = CLIENT_TESTS_DESKTOP_BROWSERS;

    return testClient('test/client/legacy-fixtures/**/*-test.js', CLIENT_TESTS_LEGACY_SETTINGS, saucelabsSettings);
});

gulp.task('test-client-legacy-travis', gulp.series('build', 'test-client-legacy-travis-run'));

gulp.step('test-client-legacy-travis-mobile-run', () => {
    const saucelabsSettings = CLIENT_TESTS_SAUCELABS_SETTINGS;

    saucelabsSettings.browsers = CLIENT_TESTS_MOBILE_BROWSERS;

    return testClient('test/client/legacy-fixtures/**/*-test.js', CLIENT_TESTS_LEGACY_SETTINGS, saucelabsSettings);
});

gulp.task('test-client-legacy-travis-mobile', gulp.series('build', 'test-client-legacy-travis-mobile-run'));

//Documentation
gulp.task('generate-docs-readme', done => {
    function generateItem (name, url, level) {
        return ' '.repeat(level * 2) + '* [' + name + '](articles' + url + ')\n';
    }

    function generateDirectory (tocItems, level) {
        let res = '';

        tocItems.forEach(item => {
            res += generateItem(item.name ? item.name : item.url, item.url, level);

            if (item.content)
                res += generateDirectory(item.content, level + 1);
        });

        return res;
    }

    function generateReadme (toc) {
        const tocList = generateDirectory(toc, 0);

        return '# Documentation\n\n> This is the documentation\'s development version. ' +
               'The functionality described here may not be included in the current release version. ' +
               'Unreleased functionality may change or be dropped before the next release. ' +
               'The release version\'s documentation is available at the [TestCafe website](https://devexpress.github.io/testcafe/documentation/getting-started/).\n\n' +
               tocList;
    }

    const toc    = yaml.safeLoad(fs.readFileSync('docs/nav/nav-menu.yml', 'utf8'));
    const readme = generateReadme(toc);

    fs.writeFileSync('docs/README.md', readme);

    done();
});

gulp.task('lint-docs', () => {
    function lintFiles (files, config) {
        return new Promise((resolve, reject) => {
            markdownlint({ files: files, config: config }, (err, result) => {
                const lintErr = err || result && result.toString();

                if (lintErr)
                    reject(lintErr);
                else
                    resolve();
            });
        });
    }

    const lintDocsAndExamples = globby([
        'docs/articles/**/*.md',
        '!docs/articles/faq/**/*.md',
        '!docs/articles/documentation/recipes/**/*.md',
        '!docs/articles/blog/**/*.md',
        'examples/**/*.md'
    ]).then(files => {
        return lintFiles(files, require('./.md-lint/docs.json'));
    });

    const lintFaq = globby([
        'docs/articles/faq/**/*.md'
    ]).then(files => {
        return lintFiles(files, require('./.md-lint/faq.json'));
    });

    const lintBlog = globby([
        'docs/articles/blog/**/*.md'
    ]).then(files => {
        return lintFiles(files, require('./.md-lint/blog.json'));
    });

    const lintRecipes = globby([
        'docs/articles/documentation/recipes/**/*.md'
    ]).then(files => {
        return lintFiles(files, require('./.md-lint/recipes.json'));
    });

    const lintReadme    = lintFiles('README.md', require('./.md-lint/readme.json'));
    const lintChangelog = lintFiles('CHANGELOG.md', require('./.md-lint/changelog.json'));

    return Promise.all([lintDocsAndExamples, lintReadme, lintChangelog, lintRecipes, lintFaq, lintBlog]);
});

gulp.task('clean-website', () => {
    return del('site');
});

gulp.step('fetch-assets-repo', cb => {
    git.clone('https://github.com/DevExpress/testcafe-gh-page-assets.git', { args: 'site' }, cb);
});

gulp.step('put-in-articles', () => {
    return gulp
        .src(['docs/articles/**/*', '!docs/articles/blog/**/*'])
        .pipe(gulp.dest('site/src'));
});

gulp.step('put-in-posts', () => {
    return gulp
        .src('docs/articles/blog/**/*')
        .pipe(gulp.dest('site/src/_posts'));
});

gulp.step('put-in-navigation', () => {
    return gulp
        .src('docs/nav/**/*')
        .pipe(gulp.dest('site/src/_data'));
});

gulp.step('put-in-publications', () => {
    return gulp
        .src('docs/publications/**/*')
        .pipe(gulp.dest('site/src/_data'));
});

gulp.step('put-in-tweets', () => {
    return gulp
        .src('docs/tweets/**/*')
        .pipe(gulp.dest('site/src/_data'));
});

gulp.step('put-in-website-content', gulp.parallel('put-in-articles', 'put-in-navigation', 'put-in-posts', 'put-in-publications', 'put-in-tweets'));
gulp.step('prepare-website-content', gulp.series('clean-website', 'fetch-assets-repo', 'put-in-website-content'));

gulp.step('prepare-website', gulp.parallel('lint-docs', 'prepare-website-content'));

function buildWebsite (mode, cb) {
    const options = mode ? { stdio: 'inherit', env: { JEKYLL_ENV: mode } } : { stdio: 'inherit' };

    spawn('jekyll', ['build', '--source', 'site/src/', '--destination', 'site/deploy'], options)
        .on('exit', cb);
}

// NOTE: we have three website build configurations.
//
// * production - used when the website is built for publishing. Gulp task 'build-website-production'.
// * development - used when the website is built for local deployment. Gulp task 'build-website-development'.
// * testing - used when the website is built for testing. Gulp task 'build-website-testing'.
//
// This is how they affect the website.
//
// * Blog comments.
//   - Do not appear in testing mode.
//   - In development mode, comments from an internal 'staging' thread are displayed.
//   - In production mode, public comment threads are displayed.
// * Google Analytics is enabled in production mode only.

gulp.step('build-website-production-run', cb => {
    buildWebsite('production', cb);
});

gulp.task('build-website-production', gulp.series('prepare-website', 'build-website-production-run'));

gulp.step('build-website-development-run', cb => {
    buildWebsite('development', cb);
});

gulp.task('build-website-development', gulp.series('prepare-website', 'build-website-development-run'));

gulp.step('build-website-testing-run', cb => {
    buildWebsite('testing', cb);
});

gulp.task('build-website-testing', gulp.series('prepare-website', 'build-website-testing-run'));

gulp.step('build-website-run', cb => {
    buildWebsite('', cb);
});

gulp.task('build-website', gulp.series('prepare-website', 'build-website-run'));

gulp.task('serve-website', cb => {
    const app = connect()
        .use('/testcafe', serveStatic('site/deploy'));

    websiteServer = app.listen(8080, cb);
});

gulp.step('preview-website-open', () => {
    return open('http://localhost:8080/testcafe');
});

gulp.task('preview-website', gulp.series('build-website-development', 'serve-website', 'preview-website-open'));

gulp.step('test-website-run', () => {
    const WebsiteTester = require('./test/website/test.js');
    const websiteTester = new WebsiteTester();

    return websiteTester
        .checkLinks()
        .then(failed => {
            return new Promise((resolve, reject) => {
                websiteServer.close(() => {
                    if (failed)
                        reject('Broken links found!');
                    else
                        resolve();
                });
            });
        });
});

gulp.task('test-website', gulp.series('build-website-testing', 'serve-website', 'test-website-run'));

gulp.task('test-website-travis', gulp.series('build-website', 'serve-website', 'test-website-run'));

gulp.step('website-publish-run', () => {
    // TODO: move this import to the top level when we drop Node.js 6.x
    const ghpages = require('gulp-gh-pages');

    return gulp
        .src('site/deploy/**/*')
        .pipe(rename(filePath => {
            filePath.dirname = filePath.dirname.toLowerCase();

            return filePath;
        }))
        .pipe(prompt.confirm({
            message: 'Are you sure you want to publish the website?',
            default: false
        }))
        .pipe(ghpages());
});

gulp.task('publish-website', gulp.series('build-website-production', 'website-publish-run'));

gulp.task('test-docs-travis', gulp.parallel('test-website-travis', 'lint'));


function testFunctional (fixturesDir, testingEnvironmentName, browserProviderName) {
    process.env.TESTING_ENVIRONMENT       = testingEnvironmentName;
    process.env.BROWSER_PROVIDER          = browserProviderName;
    process.env.BROWSERSTACK_USE_AUTOMATE = 1;

    if (!process.env.BROWSERSTACK_NO_LOCAL)
        process.env.BROWSERSTACK_NO_LOCAL = 1;

    if (DEV_MODE)
        process.env.DEV_MODE = 'true';

    return gulp
        .src(['test/functional/setup.js', fixturesDir + '/**/test.js'])
        .pipe(mocha({
            ui:       'bdd',
            reporter: 'spec',
            timeout:  typeof v8debug === 'undefined' ? 3 * 60 * 1000 : Infinity // NOTE: disable timeouts in debug
        }));
}

gulp.step('test-functional-travis-desktop-osx-and-ms-edge-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.osXDesktopAndMSEdgeBrowsers, functionalTestConfig.browserProviderNames.browserstack);
});

gulp.task('test-functional-travis-desktop-osx-and-ms-edge', gulp.series('build', 'test-functional-travis-desktop-osx-and-ms-edge-run'));

gulp.step('test-functional-travis-mobile-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.mobileBrowsers, functionalTestConfig.browserProviderNames.browserstack);
});

gulp.task('test-functional-travis-mobile', gulp.series('build', 'test-functional-travis-mobile-run'));

gulp.step('test-functional-local-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.localBrowsers);
});

gulp.task('test-functional-local', gulp.series('build', 'test-functional-local-run'));

gulp.step('test-functional-local-ie-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.localBrowsersIE);
});

gulp.task('test-functional-local-ie', gulp.series('build', 'test-functional-local-ie-run'));

gulp.step('test-functional-local-chrome-firefox-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.localBrowsersChromeFirefox);
});

gulp.task('test-functional-local-chrome-firefox', gulp.series('build', 'test-functional-local-chrome-firefox-run'));

gulp.step('test-functional-local-headless-chrome-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.localHeadlessChrome);
});

gulp.task('test-functional-local-headless-chrome', gulp.series('build', 'test-functional-local-headless-chrome-run'));

gulp.step('test-functional-local-headless-firefox-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.localHeadlessFirefox);
});

gulp.task('test-functional-local-headless-firefox', gulp.series('build', 'test-functional-local-headless-firefox-run'));

gulp.step('test-functional-remote-run', () => {
    if (QR_CODE)
        process.env.QR_CODE = 'true';

    if (BROWSER_ALIAS)
        process.env.BROWSER_ALIAS = BROWSER_ALIAS;

    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.remote, functionalTestConfig.browserProviderNames.remote);
});

gulp.task('test-functional-remote', gulp.series('build', 'test-functional-remote-run'));

gulp.step('test-functional-local-legacy-run', () => {
    return testFunctional('test/functional/legacy-fixtures', functionalTestConfig.testingEnvironmentNames.legacy);
});

gulp.task('test-functional-local-legacy', gulp.series('build', 'test-functional-local-legacy-run'));

gulp.step('test-functional-travis-old-browsers-run', () => {
    return testFunctional('test/functional/fixtures', functionalTestConfig.testingEnvironmentNames.oldBrowsers, functionalTestConfig.browserProviderNames.sauceLabs);
});

gulp.task('test-functional-travis-old-browsers', gulp.series('build', 'test-functional-travis-old-browsers-run'));

function getDockerEnv (machineName) {
    return childProcess
        .execSync('docker-machine env --shell bash ' + machineName)
        .toString()
        .split('\n')
        .map(line => {
            return line.match(/export\s*(.*)="(.*)"$/);
        })
        .filter(match => {
            return !!match;
        })
        .reduce((env, match) => {
            env[match[1]] = match[2];
            return env;
        }, {});
}

function isDockerMachineRunning (machineName) {
    try {
        return childProcess.execSync('docker-machine status ' + machineName).toString().match(/Running/);
    }
    catch (e) {
        return false;
    }
}

function isDockerMachineExist (machineName) {
    try {
        childProcess.execSync('docker-machine status ' + machineName);
        return true;
    }
    catch (e) {
        return !e.message.match(/Host does not exist/);
    }
}

function startDocker () {
    const dockerMachineName = process.env['DOCKER_MACHINE_NAME'] || 'default';

    if (!isDockerMachineExist(dockerMachineName))
        childProcess.execSync('docker-machine create -d virtualbox ' + dockerMachineName);

    if (!isDockerMachineRunning(dockerMachineName))
        childProcess.execSync('docker-machine start ' + dockerMachineName);

    const dockerEnv = getDockerEnv(dockerMachineName);

    assignIn(process.env, dockerEnv);
}

function isDockerDesktopRunning () {
    try {
        const processInfo = childProcess.execSync('wmic process get Name /format:list').toString();

        return processInfo.match(/Docker for Windows.exe/);
    }
    catch (e) {
        return false;
    }
}

function ensureDockerEnvironment () {
    if (isDockerDesktopRunning())
        return;

    if (!process.env['DOCKER_HOST']) {
        try {
            startDocker();
        }
        catch (e) {
            throw new Error('Unable to initialize Docker environment. Use Docker terminal to run this task.\n' +
                e.stack);
        }
    }
}

gulp.task('docker-build', done => {
    childProcess.execSync('npm pack', { env: process.env }).toString();

    ensureDockerEnvironment();

    const packageId  = `${packageInfo.name}-${packageInfo.version}.tgz`;
    const tagCommand = PUBLISH_TAGS.map(tag => `-t ${PUBLISH_REPO}:${tag}`).join(' ');
    const command    = `docker build --no-cache --build-arg packageId=${packageId} ${tagCommand} -f docker/Dockerfile .`;

    childProcess.execSync(command, { stdio: 'inherit', env: process.env });

    done();
});

gulp.task('docker-test', done => {
    ensureDockerEnvironment();

    childProcess.execSync(`docker build --no-cache --build-arg tag=${packageInfo.version} -t docker-server-tests -f test/docker/Dockerfile .`,
        { stdio: 'inherit', env: process.env });

    done();
});

gulp.step('docker-publish-run', done => {
    PUBLISH_TAGS.forEach(tag => {
        childProcess.execSync(`docker push ${PUBLISH_REPO}:${tag}`, { stdio: 'inherit', env: process.env });
    });

    done();
});

gulp.task('docker-publish', gulp.series('docker-build', 'docker-test', 'docker-publish-run'));

gulp.task('travis', process.env.GULP_TASK ? gulp.series(process.env.GULP_TASK) : () => {});
