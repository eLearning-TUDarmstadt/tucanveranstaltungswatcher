// Einstellungen
var TRY_TO_LOAD_SAVED_COURSES = true;
var SKIP_ALREADY_CHECKED_COURSES = false;
var RECHECK_BROKEN_COURSES = true;
var MOODLE_BASEPATH = "https://moodle.tu-darmstadt.de";

// Falls nur Kurse mit Suchbegriff gecheckt werden sollen
// ACHTUNG: Keine Semester wählen, die mehr als ein Semester in der Zukunft liegen
// (Das gesuchte Semester muss in der Suche des Vorlesungsverzeichnisses auswählbar sein)
var CHECK_BY_NAME = true;
var SEARCH_TERM = "SoSe 2018";

// Wenn zu hoch, kommt es zu Fehlern!
var NUM_OF_JOBS = 10;
// </Einstellungen>


//const v8 = require('v8');
//v8.setFlagsFromString('--stack-size 65500');

var request = require('request');
var Nightmare = require('nightmare');
var async = require('async');
var load = require('load-script');
var nightmare = Nightmare({
    show: false, // Browserfenster anzeigen?
    openDevTools: {
        mode: 'detach'
    },
    waitTimeout: 20000
});
var jsonfile = require('jsonfile');
var fs = require('fs');

var coursesFile = 'courses.js';
var COURSES_WITH_ID_PATH = MOODLE_BASEPATH + "/local/littlehelpers/rest/allcourseswithidnumber.php";
var MOODLE_USER = "";
var MOODLE_PW = "";
var tucan_search_url = "https://www.tucan.tu-darmstadt.de/scripts/mgrqcgi?APPNAME=CampusNet&PRGNAME=ACTION&ARGUMENTS=-AvZNBmPA8HR9ViqwlhHpmQF.oetZt1V8rztQkAhzpQpF72H9Vc08oggaMcGf5P3oL3ZXcHyicze5yNRikSl-Yof90WR--T7==";
var tucan_semester_ids = null;
var courses = {};

// Zwischenspeicher für das Ergebnis von Moodle 
var found_moodle_courses = {};

//
// Programmablauf
//

// CMD-Argumente => Moodle username + password
if (process.argv.length !== 4) {
    console.log("Mit den Parametern stimmt etwas nicht...");
    console.log("Aufruf mit:");
    console.log("npm start 'moodle-username' 'moodle-password'");
    process.exit(1);
} else {
    MOODLE_USER = process.argv[2];
    MOODLE_PW = process.argv[3];
}


loginfo("Versuche Login auf Moodle");
loginToMoodle().then(function () {
    loginfo("Hole alle Kurse mit courseid von Moodle (" + MOODLE_BASEPATH + ")");
    getMoodleCourses()
        .then(function () {

            // Entferne auf Moodle gelöschten Kurse
            for (var id in courses) {
                if (!found_moodle_courses[id]) {
                    loginfo("Gelöschter Kurs #" + id + ":\t" + courses[id].shortname);
                    delete courses[id];
                }
            }
            saveCourses();

            loginfo("Hole URL der Veranstaltungssuche auf TUCaN");
            getSearchURL().then(function () {
                loginfo("Hole alle TUCaN Semester IDs");
                getSemesterIDs().then(function () {
                    loginfo("Ergänze zu jedem Kurs die entsprechende Semester ID");
                    addSemesterIdToCourses().then(function () {
                        loginfo("Prüfe für " + Object.keys(courses).length + " Kurse ob die idnumber zu einem Suchergebnis passt");
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
                        }, function (error) {
                            logerror("Fehler beim hinzufügen der Verfügbarkeiten");
                            console.log(error);
                        });

                    });
                });
            });
        });
});
// </Programmablauf>

//
// Ab hier Hilfsfunktionen
// 

function checkCourse(course) {
    // Soll der Name gecheckt werden?
    var check_by_name = !CHECK_BY_NAME || (course.shortname.indexOf(SEARCH_TERM) > 0 || course.fullname.indexOf(SEARCH_TERM) > 0);
    //console.log("\t\tCheck by name: " + check_by_name);
    var skip_checked = (SKIP_ALREADY_CHECKED_COURSES && (typeof course.available) !== "undefined");
    //console.log("\t\tSkip checked: " + skip_checked);
    var undef = (typeof course.available) === "undefined";
    //console.log("\t\tUndef: " + undef);
    var recheck = RECHECK_BROKEN_COURSES && course.available === 0;
    //console.log("\t\tRecheck: " + recheck);
    return check_by_name && (undef || !skip_checked || recheck);
}

/**
 * Organisiert die Prüfung aller Kurse
 */
function addAvailabilityToCourses() {
    return new Promise(function (resolve, reject) {
        var cargo = async.cargo(function (tasks, callback) {
            async.eachOf(tasks, function (info, key, cb) {
                var course = info.course;
                console.log("Checking #" + course.id + ":\t" + course.shortname);
                if (checkCourse(course)) {
                    checkAvailability(course).then(function (available) {
                        courses[course.id].available = available;
                        saveCourses();
                        process.nextTick(cb);
                    }, function (error) {
                        logerror("Fehler bei Prüfung!");
                        console.log(error);
                        process.nextTick(cb);
                    });
                } else {
                    loginfo("\t => Kurs wird übersprungen");
                    process.nextTick(cb);
                }
            }, function (error) {
                process.nextTick(callback);
            });
        }, NUM_OF_JOBS);

        cargo.drain = function (error) {
            if (error) {
                logerror("Fehler bei Cargo!");
                console.log(error);
                reject();
            } else {
                resolve();
            }
        };

        var coursesToCheck = [];
        async.eachOfSeries(courses, function (c, i, callback) {
            if (checkCourse(c)) {
                coursesToCheck.push({
                    course: c
                });
            }
            process.nextTick(callback);
        }, function () {
            cargo.push(coursesToCheck);
        });
    });
}

/**
 * Prüft ob sich zu einem Kurs, genauer seiner Veranstaltungsnummer und seinem Semester
 * eine TUCaN-Veranstaltung mit gleicher idnumber finden lässt
 */
function checkAvailability(course) {
    return new Promise(function (resolve, reject) {
        // Ermittlung der Veranstaltungsnummer
        var veranstnummer = shortnameToVeranstNummer(course.shortname);
        if (!veranstnummer) {
            veranstnummer = fullnameToVeranstNummer(course.fullname);
        }
        if (!veranstnummer) {
            logerror("Keine Veranstaltungsnummer für " + course.shortname + " gefunden");
            resolve("no lv-number");
        }

        if(!course.semesterId) {
            logerror("Keine SemesterId für " + course.shortname + " gefunden. Ist das Sem. schon im VL-Verz?!");
            resolve("no semesterId");
        }
        // Veranstaltungsnummer gefunden, suche auf TUCaN danach
        else {
            var n = Nightmare({
                show: false, // Browserfenster anzeigen?
                //waitTimeout: 10000
            });
            n
                .goto(tucan_search_url)
                .wait('form[id="findcourse"]')
                .select('select[id="course_catalogue"]', course.semesterId)
                .insert('input[id="course_number"]', veranstnummer)
                .click('input[name="submit_search"]')
                // Auf Suchergebnisse oder Fehlermeldung warten
                .wait(function () {
                    var results = document.querySelectorAll('tr[class="tbdata"] td a');
                    var position = document.documentElement.innerHTML.indexOf('Keine Veranstaltungen gefunden');
                    console.log(position);
                    return (results.length > 0 || position > 0);
                })
                // Links zu den Veranstaltungsseiten der Suchergebnisse zurückgeben
                .evaluate(function () {
                    var rows = document.querySelectorAll('tr[class="tbdata"] td a');
                    return [].map.call(rows, function (row) {
                        return row.href;
                    });
                })
                .end()
                .then(function (results) {
                    async.eachOfSeries(results, function (result, key, goOn) {
                            // idnumber in Link enthalten?
                            if (result.indexOf(course.idnumber) !== -1) {
                                loginfo("\t => OKAY!");
                                resolve(1);
                            } else {
                                goOn();
                            }
                        },
                        // Aufruf wenn fertig oder Fehler
                        function (error) {
                            if (error) {
                                logerror("Fehler in checkAvailability:");
                                console.log(error);
                                resolve();
                            } else {
                                resolve(0);
                            }
                        })
                })
                .catch(function (error) {
                    logerror("Fehler in checkAvailability:");
                    console.log(error);
                    resolve();
                })
        }
    });
}

/**
 * Gibt die URL zur TUCaN Veranstaltungsseite zurück
 * 
 * Bin ursprünglich davon ausgegangen, dass sich die URL von Suche zu Suche ändert
 */
function getSearchURL() {
    return new Promise(function (resolve, reject) {
        resolve(tucan_search_url);
    });
}

/**
 * Extrahiert aus der TUCaN Veranstaltungssuchseite alle Semester und ihre TUCaN IDs
 */
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

/**
 * Holt alle Moodle-Kurse mit einer nicht leeren idnumber
 * 
 * Damit das klappt ist es nötig, dass das Plugin local/littlehelpers installiert ist
 */
function getMoodleCourses() {
    return new Promise(function (resolve, reject) {
        // Load courses file
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
            .wait()
            .evaluate(function () {
                var json_text = document.body.innerText;
                var json = JSON.parse(json_text);
                return Object.keys(json).map(function (x) {
                    return json[x];
                });
            })
            .then(function (c) {
                // Jeden Kurs einzeln hinzufügen, um nichts zu überschreiben
                async.eachOf(c, function (course, index, goOn) {
                        found_moodle_courses[course.id] = course;

                        // Kurs schon vorhanden? => Update
                        if (courses[course.id]) {
                            for (var key in course) {
                                courses[course.id][key] = course[key];
                            }
                            goOn();
                        } else {
                            loginfo("Neuer Kurs: " + course.shortname);
                            courses[course.id] = course;
                            goOn();
                        }
                    },
                    // Wenn fertig oder Fehler
                    function (error) {
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

/**
 * Geht alle Kurse durch und ergänzt sie jeweils um die zugehörige 
 * TUCaN Semester ID
 */
function addSemesterIdToCourses() {
    return new Promise(function (resolve, reject) {
        var size = courses.length;

        async.eachOfSeries(courses, function (course, key, goOn) {
                semesterToID(course.semester).then(function (semesterId) {
                    courses[key].semesterId = semesterId;
                    goOn();
                });
            },
            // Wenn Fehler oder fertig
            function (error) {
                if (error) {
                    console.log(error);
                    reject();
                } else {
                    saveCourses();
                    resolve();
                }
            });
    });
}

/**
 * Übersetzt ein Semester (WiSe 2015/16) in die zugehörige TUCaN-ID
 */
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
            logerror.error("Fehler beim Ergänzen der SemesterID");
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
            .click('button[id="loginbtn"]')
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

function fullnameToVeranstNummer(fullname) {
    return shortnameToVeranstNummer(fullname);
}

function loginfo(info) {
    console.log("[*] " + info);
}

function logerror(error) {
    console.log("[!!!] " + error);
}

function saveCourses() {
    fs.writeFileSync(coursesFile, "var courses = " + JSON.stringify(courses, null, 2) + ";");
}
