-- MySQL dump 10.13  Distrib 8.0.19, for osx10.13 (x86_64)
--
-- Host: localhost    Database: shoppinglist
-- ------------------------------------------------------
-- Server version	8.0.19

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `shoppinglist`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shoppinglist` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `shoppinglist`;

--
-- Table structure for table `ingredient`
--

DROP TABLE IF EXISTS `ingredient`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ingredient` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ingredient`
--

LOCK TABLES `ingredient` WRITE;
/*!40000 ALTER TABLE `ingredient` DISABLE KEYS */;
INSERT INTO `ingredient` VALUES (1,'potato','2020-06-07 15:29:47','2020-06-07 15:29:47'),(2,'minced beef','2020-06-07 15:41:38','2020-06-07 15:41:38'),(3,'lemon','2020-06-07 15:41:55','2020-06-07 15:41:55'),(4,'onion','2020-06-08 20:32:48','2020-06-08 20:32:48'),(5,'carrot','2020-06-08 20:32:55','2020-06-08 20:32:55'),(6,'garlic','2020-06-08 20:33:01','2020-06-08 20:33:01'),(7,'Worcestershire Sauce','2020-06-08 20:33:20','2020-06-08 20:33:20'),(8,'Tomato Puree','2020-06-08 20:33:28','2020-06-08 20:33:28'),(9,'Thyme','2020-06-08 20:33:37','2020-06-08 20:33:37'),(10,'Rosemary','2020-06-08 20:33:43','2020-06-08 20:33:43'),(11,'Chicken Stock','2020-06-08 20:33:49','2020-06-08 20:33:49'),(12,'Spaghetti','2020-06-08 22:54:31','2020-06-08 22:54:31'),(13,'Tinned Tomatoes','2020-06-08 22:54:41','2020-06-08 22:54:41'),(14,'Mixed herbs','2020-06-08 22:54:55','2020-06-08 22:54:55'),(15,'Beef Stock','2020-06-08 22:55:10','2020-06-08 22:55:10'),(16,'Parmesan','2020-06-08 22:55:20','2020-06-08 22:55:20'),(17,'Mushrooms','2020-06-08 22:58:40','2020-06-08 22:58:40');
/*!40000 ALTER TABLE `ingredient` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `part`
--

DROP TABLE IF EXISTS `part`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `part` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `recipe_id` int NOT NULL COMMENT 'foreign key into recipe table',
  `ingredient_id` int NOT NULL COMMENT 'foreign key into ingredient table',
  `unit_id` int NOT NULL COMMENT 'foreign key into unit table',
  `quantity` varchar(20) NOT NULL COMMENT 'mixed number',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_part_recipe_id` (`recipe_id`),
  KEY `fk_part_ingredient_id` (`ingredient_id`),
  KEY `fk_part_unit_id` (`unit_id`),
  CONSTRAINT `fk_part_ingredient_id` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient` (`id`),
  CONSTRAINT `fk_part_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`),
  CONSTRAINT `fk_part_unit_id` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `part`
--

LOCK TABLES `part` WRITE;
/*!40000 ALTER TABLE `part` DISABLE KEYS */;
INSERT INTO `part` VALUES (1,3,1,3,'1','2020-06-08 20:02:16','2020-06-08 20:32:22'),(2,3,2,2,'800','2020-06-08 20:03:11','2020-06-08 20:29:56'),(3,2,3,1,'1','2020-06-08 20:03:23','2020-06-08 20:03:23'),(4,3,4,1,'1','2020-06-08 20:35:19','2020-06-08 20:35:19'),(5,3,5,1,'1','2020-06-08 20:35:30','2020-06-08 20:35:30'),(7,3,6,4,'2','2020-06-08 20:37:05','2020-06-08 20:37:05'),(8,3,7,5,'2','2020-06-08 20:37:20','2020-06-08 20:37:20'),(9,3,8,5,'1','2020-06-08 20:37:30','2020-06-08 20:37:30'),(10,3,9,1,'1','2020-06-08 20:37:45','2020-06-08 20:37:45'),(11,3,10,1,'1','2020-06-08 20:37:51','2020-06-08 20:37:51'),(12,3,11,6,'300','2020-06-08 20:38:06','2020-06-08 20:38:06'),(13,4,12,2,'200','2020-06-08 23:01:56','2020-06-08 23:01:56'),(14,4,2,2,'500','2020-06-08 23:02:14','2020-06-08 23:02:14'),(15,4,13,1,'1','2020-06-08 23:02:33','2020-06-08 23:02:33'),(16,4,4,1,'1','2020-06-08 23:02:44','2020-06-08 23:02:44'),(17,4,6,4,'3','2020-06-08 23:02:59','2020-06-08 23:02:59'),(18,4,8,5,'2','2020-06-08 23:03:18','2020-06-08 23:03:18'),(19,4,15,6,'200','2020-06-08 23:03:32','2020-06-08 23:03:32'),(20,4,17,2,'150','2020-06-08 23:03:54','2020-06-08 23:03:54');
/*!40000 ALTER TABLE `part` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recipe`
--

DROP TABLE IF EXISTS `recipe`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recipe` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `slug` varchar(60) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_recipe_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recipe`
--

LOCK TABLES `recipe` WRITE;
/*!40000 ALTER TABLE `recipe` DISABLE KEYS */;
INSERT INTO `recipe` VALUES (1,'Roast Pork','2020-06-07 14:29:57','2020-06-07 14:50:32','roast-pork'),(2,'Lemon Meringue Pie','2020-06-07 14:52:19','2020-06-07 14:54:09','lemon-meringue-pie'),(3,'Shepherds Pie','2020-06-07 14:53:40','2020-06-07 14:53:40','shepherds-pie'),(4,'Spaghetti Bolognese','2020-06-08 22:59:32','2020-06-08 22:59:32','spaghetti-bolognese');
/*!40000 ALTER TABLE `recipe` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `unit`
--

DROP TABLE IF EXISTS `unit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unit` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `unit`
--

LOCK TABLES `unit` WRITE;
/*!40000 ALTER TABLE `unit` DISABLE KEYS */;
INSERT INTO `unit` VALUES (1,'','2020-06-08 20:00:42','2020-06-08 20:00:42'),(2,'gram','2020-06-08 20:29:26','2020-06-08 20:29:26'),(3,'kilogram','2020-06-08 20:31:59','2020-06-08 20:31:59'),(4,'clove','2020-06-08 20:35:45','2020-06-08 20:35:45'),(5,'tablespoons','2020-06-08 20:35:58','2020-06-08 20:35:58'),(6,'milliletres','2020-06-08 20:36:08','2020-06-08 20:36:08');
/*!40000 ALTER TABLE `unit` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2020-06-08 23:06:22
