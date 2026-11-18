plugins {
    `java-library`
    `maven-publish`
}

group = "com.youngminkim.recanet"
version = "0.1.0-rc.2"

val publicRelease = providers.gradleProperty("publicRelease").isPresent
val releaseLicense = providers.gradleProperty("recanetLicense")
val repositoryUrl = "https://github.com/RecycleFarm/recanet-sdk"
val projectLicenseFile = rootProject.file("../../LICENSE")

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
    withJavadocJar()
    if (publicRelease) withSourcesJar()
}

dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.22.4"))
    implementation("io.privy.api:privy-java:0.59.0") {
        exclude(group = "org.bouncycastle", module = "bcprov-jdk18on")
    }
    implementation("com.nimbusds:nimbus-jose-jwt:10.10")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.4")
    implementation("org.bouncycastle:bcprov-jdk15to18:1.85")
    implementation("io.github.erdtman:java-json-canonicalization:1.1")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform { excludeTags("live-dmrvn") } }

tasks.register<Test>("dmrvnPetLiveTest") {
    group = "verification"
    description = "Opt-in PET testnet E2E; test-only user signature, real Privy Relay and Greenfield"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform { includeTags("live-dmrvn") }
    testLogging.showStandardStreams = true
    outputs.upToDateWhen { false }
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            artifactId = "recanet-java"
            from(components["java"])
            pom {
                name.set("Recanet Java SDK")
                description.set("Recanet backend Java SDK")
                url.set(repositoryUrl)
                developers {
                    developer {
                        id.set("RecycleFarm")
                        name.set("RecycleFarm")
                        url.set("https://github.com/RecycleFarm")
                    }
                }
                scm {
                    url.set(repositoryUrl)
                    connection.set("scm:git:$repositoryUrl.git")
                    developerConnection.set("scm:git:ssh://git@github.com/RecycleFarm/recanet-sdk.git")
                }
                releaseLicense.orNull?.let { spdx ->
                    licenses {
                        license {
                            name.set(spdx)
                            url.set("https://spdx.org/licenses/$spdx.html")
                            distribution.set("repo")
                        }
                    }
                }
            }
        }
    }
}

val examples by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output + configurations.runtimeClasspath.get()
    runtimeClasspath += output + compileClasspath
}

tasks.register<JavaExec>("dmrvnDiagnostics") {
    group = "verification"
    description = "Read-only DMRVN testnet checks; no transactions or wallet creation"
    classpath = examples.runtimeClasspath
    mainClass.set("com.youngminkim.recanet.dmrvn.DmrvnDiagnostics")
    args(providers.gradleProperty("dmrvnMode").getOrElse("chain"))
}

tasks.register<JavaExec>("dmrvnPet") {
    group = "verification"
    description = "Explicit PET testnet workflow; evidence/submit can spend testnet gas"
    classpath = examples.runtimeClasspath
    mainClass.set("com.youngminkim.recanet.dmrvn.DmrvnPetExample")
    args(providers.gradleProperty("dmrvnAction").getOrElse("read"))
}

tasks.withType<Jar>().configureEach {
    archiveBaseName.set("recanet-java")
    from(projectLicenseFile) { into("META-INF") }
}
