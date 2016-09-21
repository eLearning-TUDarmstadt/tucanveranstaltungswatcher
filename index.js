// Einstellungen
var TRY_TO_LOAD_SAVED_COURSES = true;
var SKIP_ALREADY_CHECKED_COURSES = true;
var MOODLE_BASEPATH = "https://mdl-beta.un.hrz.tu-darmstadt.de";
// </Einstellungen>


var request = require('request');
var Nightmare = require('nightmare');
var async = require('async');
var load = require('load-script');
var nightmare = Nightmare({
    show: false, // Browserfenster anzeigen?
    openDevTools: {
        mode: 'detach'
    },
    waitTimeout: 2000
});
var jsonfile = require('jsonfile');
var fs = require('fs');

var coursesFile = 'courses.js';

//var MOODLE_BASEPATH = "http://localhost/moodle";
var COURSES_WITH_ID_PATH = MOODLE_BASEPATH + "/local/littlehelpers/rest/allcourseswithidnumber.php";


var MOODLE_USER = "";
var MOODLE_PW = "";

var tucan_search_url = "https://www.tucan.tu-darmstadt.de/scripts/mgrqcgi?APPNAME=CampusNet&PRGNAME=ACTION&ARGUMENTS=-AIxtcTTmUEuAV1Qg8GNK553JXuajPTfa0gb2M3QdGHiHkLl9C4p3xgJB7tjNf0gDpSsKsQ4BOqcIqeunOQBYvCUY3iyTTHn==";

var courses = {};

if(process.argv.length !== 4) {
    console.log("Mit den Parametern stimmt etwas nicht...");
    console.log("Aufruf mit:");
    console.log("npm start 'moodle-username' 'moodle-password'");
    process.exit(1);
} else {
    MOODLE_USER = process.argv[2];
    MOODLE_PW = process.argv[3];
}

var tucan_semester_ids = null;

loginfo("Versuche Login auf Moodle");
loginToMoodle().then(function () {
    loginfo("Hole alle Kurse mit courseid von Moodle (" + MOODLE_BASEPATH + ")");
    getMoodleCourses()
        .then(function () {
            loginfo("Hole URL der Veranstaltungssuche auf TUCaN");
            getSearchURL().then(function () {
                loginfo("Hole alle TUCaN Semester IDs");
                getSemesterIDs().then(function () {
                    loginfo("Ergänze zu jedem Kurs die entsprechende Semester ID");
                    addSemesterIdToCourses().then(function () {
                        loginfo("Prüfe für " + courses.length + " Kurse ob die idnumber zu einem Suchergebnis passt");
                        addAvailabilityToCourses().then(function () {

                            //console.log("Courses:");
                            //console.log(courses);
                            //console.log("Search URL:");
                            //console.log(tucan_search_url);
                            //console.log("Semester IDs:");
                            //console.log(tucan_semester_ids);

                            loginfo("Schreibe Ergebnis in die Datei courses.json");
                            saveCourses();
                            loginfo("Fertig.")
                            process.exit();
                        });

                    });
                });
            });
        });
});

function addAvailabilityToCourses() {
    return new Promise(function (resolve, reject) {
        var promises = [];

        async.eachOfSeries(courses, function (course, i, goOn) {
            console.log("[#" + i + "] Checking " + course.shortname);
            if (SKIP_ALREADY_CHECKED_COURSES && (typeof course.available) === "undefined") {
                checkAvailability(course).then(function (available) {
                    courses[i].available = available;
                    saveCourses();
                    //console.log(available);
                    goOn();
                });
            } else {
                loginfo("\t => Kurs bereits geprüft. Überspringe.");
                goOn();
            }

        }, function (error) {
            if (error) {
                console.log(error);
                reject(error);
            } else {
                resolve();
            }
        });

    });
}

function checkAvailability(course) {
    return new Promise(function (resolve, reject) {
        var veranstnummer = shortnameToVeranstNummer(course.shortname);
        if (!veranstnummer) {
            logerror("Keine Veranstaltungsnummer für " + course.shortname + " gefunden");
            resolve(0);
        } else {
            //console.log("Veranstaltungsnummner: " + veranstnummer);
            //console.log(course);
            nightmare
                .goto(tucan_search_url)
                .wait('form[id="findcourse"]')
                .select('select[id="course_catalogue"]', course.semesterId)
                .insert('input[id="course_number"]', veranstnummer)
                .click('input[name="submit_search"]')
                .wait('ul[class="searchCriteria"]')
                .evaluate(function () {
                    var rows = document.querySelectorAll('tr[class="tbdata"] td a');
                    return [].map.call(rows, function (row) {
                        return row.href;
                    });
                })
                .then(function (results) {
                    //console.log(results)
                    async.eachOfSeries(results, function (result, key, goOn) {
                        if (result.indexOf(course.idnumber) !== -1) {
                            resolve(1);
                        } else {
                            goOn();
                        }
                    }, function (error) {
                        if (error) {
                            logerror("Fehler in checkAvailability:");
                            console.log(error);
                            reject();
                        } else {
                            resolve(0);
                        }
                    })
                })
                .catch(function (error) {
                    logerror("Fehler in checkAvailability:");
                    console.log(error);
                    resolve(0);
                })
        }
    });
}

function getSearchURL() {
    return new Promise(function (resolve, reject) {
        resolve(tucan_search_url);
        /*
        try {
            nightmare
            // Ermittle Link zur Veranstaltungssuche
            .goto('https://www.tucan.tu-darmstadt.de')
            .wait(1000)
            //.wait('div[class="pageElementTop"]')
            .click('li[id="link000334"] a')
            //.wait('div[class="pageElementTop"]')
            .wait(1000)
            .click('li[title="Lehrveranstaltungssuche"] a')
            .wait(1000)
            //.wait('div[class="pageElementTop"]')
            //.wait('form[id="findcourse"]')
            .evaluate(function() {
                return document.location.href;
            })
            .then(function (url) {
                loginfo("FOUND URL: " + url);
                console.log(url);
                tucan_search_url = url;
                resolve(tucan_search_url);
            })
            .catch(function (error) {
                logerror("URL nicht gefunden.");
                console.log(error);
                resolve(tucan_search_url);
            })
        } catch (error) {
            console.log(error);   
        }
        */
    });
}

function getSemesterIDs() {
    return new Promise(function (resolve, reject) {
        nightmare
            .goto(tucan_search_url)
            .wait('form[id="findcourse"]')
            .evaluate(function () {
                var options = document.querySelectorAll('select[name="course_catalogue"] option');
                return [].map.call(options, function (option) {
                    return {
                        value: option.value,
                        title: option.title
                    };
                });
            })
            .then(function (ids) {
                tucan_semester_ids = ids;
                resolve(ids);
            })
            .catch(function (error) {
                reject(error);
            })
    });
}

function getMoodleCourses() {
    return new Promise(function (resolve, reject) {
        // Load courses.file
        if (TRY_TO_LOAD_SAVED_COURSES) {
            try {
                if (fs.existsSync(coursesFile)) {
                    var execfile = require("./execfile.js");
                    var context = execfile(coursesFile);
                    courses = context.courses;
                }
            } catch (error) {
                console.log("Laden der Datei " + coursesFile + " fehlgeschlagen: ");
                console.log(error);
            }
        }

        // Load courses from moodle
        nightmare
            .goto(COURSES_WITH_ID_PATH)
            .wait('body')
            .evaluate(function () {
                var json_text = document.body.innerText;
                var json = JSON.parse(json_text);
                return Object.keys(json).map(function (x) { return json[x]; });
            })
            .then(function (c) {
                // Jeden Kurs einzeln hinzufügen, um nichts zu überschreiben
                async.eachOf(c, function (course, index, goOn) {
                    //loginfo("Checke Kurs " + courseid + " (" + course.shortname + ")");
                    //console.log(course);
                    // Kurs schon vorhanden
                    if (courses[course.id]) {
                        //loginfo("Kurs schon vorhanden");
                        // Update idnumber?
                        if (courses[course.id].idnumber !== course.idnumber) {
                            //loginfo("idnumber unterschiedlich");
                            courses[course.id].idnumber = course.idnumber;
                            courses[course.id].available = undefined;
                            goOn();
                        } else {
                            goOn();
                        }

                    } else {
                        loginfo("Neuer Kurs: " + course.shortname);
                        courses[course.id] = course;
                        goOn();
                    }
                }, function (error) {
                    if (error) {
                        logerror("Fehler beim Laden der Kurse:")
                        console.log(error);
                    } else {
                        saveCourses();
                        resolve();

                    }
                })
            })
            .catch(function (error) {
                console.log(error);
                reject(error);
            });
    });
}

function addSemesterIdToCourses() {
    return new Promise(function (resolve, reject) {
        //var promises = [];

        var size = courses.length;

        async.eachOfSeries(courses, function (course, key, goOn) {
            //console.log(course);
            //console.log("[#" + key + "] " + course.shortname);
            //promises.push(
            semesterToID(course.semester).then(function (semesterId) {
                //console.log(course);
                //console.log("\t=> " + semesterId);
                courses[key].semesterId = semesterId;
                goOn();
            });
            //);

        }, function (error) {
            if (error) {
                console.log(error);
                reject();
            } else {
                saveCourses();
                console.log("Erledigt");
                resolve();
            }
        });
        //Promise.all(promises).then(function () {        });
    });
}

function semesterToID(semester) {
    return new Promise(function (resolve, reject) {
        try {
            tucan_semester_ids.forEach(function (element) {
                var title = element.title;
                if (title.match(semester) !== null) {
                    resolve(element.value);
                }
            });
            resolve();
        } catch (error) {
            console.log(error);
            reject(error);
        }

    });
}

function loginToMoodle() {
    return new Promise(function (resolve, reject) {
        nightmare
            .goto(MOODLE_BASEPATH + "/login/index.php?username=" + MOODLE_USER)
            .wait()
            .goto(MOODLE_BASEPATH + "/login/index.php?username=" + MOODLE_USER)
            .wait('form[id="login"]')
            .insert('input[id="password"]', MOODLE_PW)
            .click('input[id="loginbtn"]')
            .wait('a[data-title="logout,moodle"]')
            .then(function () {
                resolve();
            })
            .catch(function (error) {
                console.log(error);
                reject();
            })
    });
}

function shortnameToVeranstNummer(shortname) {
    var regexpr = new RegExp('([a-zA-Z0-9]{2}-[a-zA-Z0-9]{2}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{2})');

    var treffer = shortname.match(regexpr);
    if (treffer) {
        return treffer[0];
    } else {
        return null;
    }
}

function loginfo(info) {
    console.log("[*] " + info);
}

function logerror(error) {
    console.log("[!!!] " + error);
}

function saveCourses() {
    fs.writeFileSync(coursesFile, "var courses = " + JSON.stringify(courses, null, 2) + ";");
    //jsonfile.writeFileSync(coursesFile, courses, { spaces: 2 });
}